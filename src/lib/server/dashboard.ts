/**
 * Widgets de dashboard configurables. Trois phases, trois fonctions :
 * `resolveDashboard` valide la config UNE fois au démarrage (appelée par
 * `createAdminRuntime`), `loadDashboard` exécute les lectures scopées par
 * requête, `groupWidgetRows` met en page — pure.
 *
 * Toute la validation vit ici et lève au boot : une faute de frappe dans un
 * nom de modèle doit arrêter le démarrage, pas produire silencieusement un
 * bloc vide à chaque rendu (même politique que `validateListFilterConfig`).
 */
import { AdminConfigError } from './errors.js';
import { combinedScopeFrom, type AdminRuntime } from './runtime.js';
import type { Model } from './types/schema.js';
import { buildWhere, parseListQuery, type ListQuery } from './query/listQuery.js';
import type { Filter } from './adapters/types.js';
import { primaryKeyOf } from './data.js';
import { redactForAudit } from './audit.js';
import type { ActiveSort } from './query/sortQuery.js';

/** Plafond dur, même politique que `MAX_PAGE_SIZE` (runtime.ts). */
const MAX_RECENT = 50;
const isLimit = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= MAX_RECENT;

/**
 * Le dashboard historique tolérait une table introspectée mais pas encore
 * migrée. Ne conserver ce repli que pour cette erreur précise : transformer
 * une panne de connexion ou une requête invalide en `0` rendrait les chiffres
 * du dashboard mensongers.
 */
function missingTableFallback<T>(error: unknown, fallback: T): T {
  const message = error instanceof Error ? error.message : '';
  const missing = /\bno such table\b|\btable\b.*\bdoes not exist\b|\brelation\b.*\bdoes not exist\b/i.test(
    message
  );
  if (!missing) throw error;
  return fallback;
}

export interface DashboardConfig {
  /** Titre de la page. Défaut : « Dashboard ». */
  title?: string;
  /** Sous-titre. Défaut : « Welcome to your admin panel ». */
  subtitle?: string;
  /**
   * Widgets, dans l'ordre d'affichage. Omis, le dashboard historique est
   * rendu ; `[]` rend une page vide, ce qui est un choix légitime et non
   * une erreur de config.
   */
  widgets?: DashboardWidget[];
}

export type DashboardWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; models?: string[] }
  | {
      type: 'count';
      model: string;
      label: string;
      /**
       * Filtre exprimé dans la query string que la vue liste comprend déjà
       * (`q=`, `f.<champ>[__<op>]=`). Conséquence voulue : un widget ne peut
       * rien exprimer que la liste ne sache montrer, la whitelist
       * d'opérateurs et l'exclusion des champs sensibles s'appliquent sans
       * seconde implémentation, et le lien « voir » pointe sur une liste dont
       * le total égale le compteur.
       */
      query?: string;
    }
  | {
      type: 'recent';
      model: string;
      title?: string;
      limit?: number;
      sort?: string;
      dir?: 'asc' | 'desc';
    };

export type ResolvedWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; modelNames: string[] }
  | { type: 'count'; modelName: string; label: string; query: ListQuery; href: string }
  | {
      type: 'recent';
      modelName: string;
      title: string;
      limit: number;
      orderBy: Record<string, 'asc' | 'desc'>;
      href: string;
    };

export interface ResolvedDashboard {
  title: string;
  subtitle: string;
  widgets: ResolvedWidget[];
}

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { type: 'stats' },
  { type: 'models', title: 'Models' }
];

export interface ResolveDashboardDeps {
  config?: DashboardConfig;
  models: Model[];
  enums: Map<string, string[]>;
  basePath: string;
  searchFieldsOf: (model: Model) => string[];
  filterableFieldsOf: (model: Model) => Set<string>;
  sortableColumnsOf: (model: Model) => string[];
  defaultSortOf: (model: Model) => ActiveSort | undefined;
  labelOf: (model: Model) => string;
}

export function resolveDashboard(deps: ResolveDashboardDeps): ResolvedDashboard {
  const widgets = (deps.config?.widgets ?? DEFAULT_WIDGETS).map((widget, index) =>
    resolveWidget(widget, index, deps)
  );
  return {
    title: deps.config?.title ?? 'Dashboard',
    subtitle: deps.config?.subtitle ?? 'Welcome to your admin panel',
    widgets
  };
}

function resolveWidget(
  widget: DashboardWidget,
  index: number,
  deps: ResolveDashboardDeps
): ResolvedWidget {
  if (widget.type === 'stats') return { type: 'stats' };

  if (widget.type === 'models') {
    const known = new Set(deps.models.map((m) => m.name));
    const modelNames = widget.models ?? deps.models.map((m) => m.name);
    for (const name of modelNames) {
      // Un modèle listé dans `exclude` n'est pas dans `models` : le refuser
      // ici est ce qui empêche un widget de le rendre visible par la porte
      // de derrière.
      if (!known.has(name)) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] references model "${name}", ` +
            `which is unknown or excluded. Known models: [${[...known].join(', ')}].`
        );
      }
    }
    return widget.title === undefined
      ? { type: 'models', modelNames }
      : { type: 'models', title: widget.title, modelNames };
  }

  if (widget.type === 'count') {
    const model = requireModel(widget.model, index, deps);
    if (!widget.label?.trim()) {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] requires a non-empty \`label\`.`
      );
    }
    const params = new URLSearchParams(widget.query ?? '');
    for (const key of params.keys()) {
      // `page`, `perPage`, `sort`, `dir` n'ont aucun effet sur un comptage :
      // les accepter laisserait croire le contraire.
      if (key !== 'q' && !key.startsWith('f.')) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] query: only "q" and "f.*" ` +
            `are supported, got "${key}".`
        );
      }
    }
    const query = parseListQuery(
      params,
      model,
      deps.enums,
      deps.searchFieldsOf(model),
      deps.filterableFieldsOf(model)
    );
    // `ignored` porte exactement ce que la liste aurait silencieusement
    // écarté : champ inconnu, non filtrable, sensible, valeur incoercible.
    // Sur une config statique c'est une faute de frappe, pas une URL
    // hostile — elle doit arrêter le démarrage.
    if (query.ignored.length > 0) {
      const keys = query.ignored.map((i) => `"${i.param}"`).join(', ');
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] query rejects ${keys}: ` +
          `unknown, non-filterable, sensitive, or uncoercible for model ` +
          `"${model.name}".`
      );
    }
    return {
      type: 'count',
      modelName: model.name,
      label: widget.label,
      query,
      href: listHref(deps.basePath, model.name, params)
    };
  }

  if (widget.type === 'recent') {
    const model = requireModel(widget.model, index, deps);
    if (widget.limit !== undefined && !isLimit(widget.limit)) {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] \`limit\` must be an integer ` +
          `between 1 and ${MAX_RECENT}.`
      );
    }
    if (widget.dir !== undefined && widget.dir !== 'asc' && widget.dir !== 'desc') {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] \`dir\` must be "asc" or "desc".`
      );
    }
    if (widget.sort !== undefined) {
      const sortable = deps.sortableColumnsOf(model);
      if (!sortable.includes(widget.sort)) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] sorts on "${widget.sort}", ` +
            `which the list view does not display. Displayed columns: ` +
            `[${sortable.join(', ')}].`
        );
      }
    }
    // Pas de devinette sur un champ nommé `createdAt` : même position que
    // `defaultSort`, deviner réordonnerait silencieusement et la devinette
    // divergerait de ce que la vue rend. Sans tri configuré, clé primaire
    // décroissante — le défaut est fourni ICI, précisément parce que
    // `findMany` n'en a aucun par lui-même (Prisma transmet `orderBy` tel
    // quel, Drizzle n'émet même pas de `ORDER BY` quand il est vide).
    const configured = deps.defaultSortOf(model);
    const field = widget.sort ?? configured?.field ?? primaryKeyOf(model);
    const dir = widget.dir ?? (widget.sort ? 'asc' : (configured?.dir ?? 'desc'));
    return {
      type: 'recent',
      modelName: model.name,
      title: widget.title ?? `Latest ${deps.labelOf(model)}`,
      limit: widget.limit ?? 5,
      orderBy: { [field]: dir },
      href: `${deps.basePath}/${model.name.toLowerCase()}`
    };
  }

  throw new AdminConfigError(
    `[sveltekit-admin] dashboard.widgets[${index}] has unknown type ` +
      `"${(widget as { type: string }).type}".`
  );
}

function requireModel(name: string, index: number, deps: ResolveDashboardDeps): Model {
  const model = deps.models.find((m) => m.name === name);
  if (!model) {
    throw new AdminConfigError(
      `[sveltekit-admin] dashboard.widgets[${index}] references model "${name}", ` +
        `which is unknown or excluded. Known models: ` +
        `[${deps.models.map((m) => m.name).join(', ')}].`
    );
  }
  return model;
}

/** Clés triées, comme `buildListUrl` : le lien reste déterministe. */
function listHref(basePath: string, modelName: string, params: URLSearchParams): string {
  const sorted = new URLSearchParams();
  for (const key of [...params.keys()].sort()) {
    for (const value of params.getAll(key)) sorted.append(key, value);
  }
  const qs = sorted.toString();
  const path = `${basePath}/${modelName.toLowerCase()}`;
  return qs ? `${path}?${qs}` : path;
}

export interface DashboardCard {
  value: number;
  label: string;
  icon: 'models' | 'records' | 'filter';
  href?: string;
}

export interface ModelCardData {
  name: string;
  label: string;
  count: number;
  href: string;
  newHref: string;
}

export interface RecentItem {
  label: string;
  href: string;
}

export type LoadedWidget =
  | { type: 'stats'; models: number; total: number }
  | { type: 'models'; title?: string; cards: ModelCardData[] }
  | { type: 'count'; label: string; value: number; href: string }
  | { type: 'recent'; title: string; href: string; items: RecentItem[] };

export type DashboardRow =
  | { kind: 'cards'; cards: DashboardCard[] }
  | { kind: 'models'; title?: string; cards: ModelCardData[] }
  | { kind: 'recent'; title: string; href: string; items: RecentItem[] };

/**
 * Replie les widgets-cartes ADJACENTS dans une même rangée. Sans ce repli,
 * deux compteurs consécutifs tomberaient dans deux blocs distincts et
 * s'empileraient verticalement au lieu de s'aligner. Pure et testée en
 * table : la mise en page ne vit pas dans le template.
 */
export function groupWidgetRows(loaded: LoadedWidget[]): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const widget of loaded) {
    if (widget.type === 'models') {
      rows.push(
        widget.title === undefined
          ? { kind: 'models', cards: widget.cards }
          : { kind: 'models', title: widget.title, cards: widget.cards }
      );
      continue;
    }
    if (widget.type === 'recent') {
      rows.push({
        kind: 'recent',
        title: widget.title,
        href: widget.href,
        items: widget.items
      });
      continue;
    }
    const cards = cardsOf(widget);
    const last = rows[rows.length - 1];
    if (last && last.kind === 'cards') last.cards.push(...cards);
    else rows.push({ kind: 'cards', cards });
  }
  return rows;
}

// `Exclude<..., { type: 'models' } | { type: 'recent' }>` : ni `models` ni
// `recent` ne sont carte-shaped, tous deux obtiennent leur propre rangée
// (voir `groupWidgetRows` ci-dessus). Si une future variante est réellement
// carte-shaped, ce type et ce switch grandiront avec elle — pas de branche
// pour un widget qui n'existe pas encore.
function cardsOf(
  widget: Exclude<LoadedWidget, { type: 'models' } | { type: 'recent' }>
): DashboardCard[] {
  if (widget.type === 'count') {
    return [{ value: widget.value, label: widget.label, icon: 'filter', href: widget.href }];
  }
  return [
    { value: widget.models, label: 'Models', icon: 'models' },
    { value: widget.total, label: 'Total Records', icon: 'records' }
  ];
}

/**
 * Un compteur par modèle, MÉMOÏSÉ pour la requête en cours : le widget
 * `stats` compte tous les modèles, et deux widgets `models` qui se recouvrent
 * réutilisent le même comptage. Sans ça, composer son dashboard se paierait
 * en requêtes dupliquées.
 *
 * `combinedScopeFrom` est appelé HORS du `try/catch` : il lève volontairement
 * sur un scope (`scope` ou `listWhere`) qui échouerait ouvert (`{}`), et cette
 * erreur-là ne doit jamais être confondue avec « la table n'existe pas
 * encore ». `countRecords` n'est pas `async` (voir
 * `adapters/prisma/dataAdapter.ts`) : un driver qui lève de façon SYNCHRONE —
 * ex. table absente — le ferait avant qu'un `.catch()` puisse s'attacher.
 * L'IIFE `async` capture ce cas comme le rejet asynchrone.
 */
function makeCounter(runtime: AdminRuntime, locals: unknown) {
  const cache = new Map<string, Promise<number>>();
  return (model: Model): Promise<number> => {
    const hit = cache.get(model.name);
    if (hit) return hit;
    const scope = combinedScopeFrom(runtime, model, { locals });
    const pending = (async () => {
      try {
        // `combinedScopeFrom` peut renvoyer un `where` Prisma imbriqué resté
        // opaque (un `listWhere` non trivial) : `countRecords` a la même
        // tolérance que `buildWhere` deux appels plus bas dans ce fichier,
        // même cast que celui-là.
        return await runtime.adapter.data.countRecords(model, scope as Filter | undefined);
      } catch (err) {
        return missingTableFallback(err, 0);
      }
    })();
    cache.set(model.name, pending);
    return pending;
  };
}

export async function loadDashboard(
  runtime: AdminRuntime,
  event: { locals?: unknown }
): Promise<{ title: string; subtitle: string; rows: DashboardRow[] }> {
  const { title, subtitle, widgets } = runtime.dashboard;
  const countOf = makeCounter(runtime, event.locals);

  const loaded: LoadedWidget[] = [];
  for (const widget of widgets) {
    if (widget.type === 'stats') {
      const counts = await Promise.all(runtime.models.map((m) => countOf(m)));
      loaded.push({
        type: 'stats',
        models: runtime.models.length,
        total: counts.reduce((sum, n) => sum + n, 0)
      });
      continue;
    }

    if (widget.type === 'count') {
      const model = runtime.models.find((m) => m.name === widget.modelName)!;
      // `combinedScopeFrom` reste HORS du `try/catch` : il lève volontairement
      // sur un scope (`scope` ou `listWhere`) qui échouerait ouvert (`{}`), et
      // cette erreur-là ne doit jamais être confondue avec « la table n'existe
      // pas encore ».
      const scope = combinedScopeFrom(runtime, model, { locals: event.locals });
      // `caseInsensitiveSearch` est faux ici comme dans la branche liste :
      // c'est le compilateur de l'adapter qui décide de la casse.
      const filter = buildWhere(widget.query, scope, false, model) as Filter | undefined;
      let value: number;
      try {
        value = await runtime.adapter.data.countRecords(model, filter);
      } catch (err) {
        value = missingTableFallback(err, 0);
      }
      loaded.push({ type: 'count', label: widget.label, value, href: widget.href });
      continue;
    }

    if (widget.type === 'recent') {
      const model = runtime.models.find((m) => m.name === widget.modelName)!;
      // `combinedScopeFrom` reste HORS du `try/catch`, même politique que la
      // branche `count` juste au-dessus : il lève volontairement sur un scope
      // (`scope` ou `listWhere`) qui échouerait ouvert (`{}`), et cette
      // erreur-là ne doit jamais être confondue avec « la table n'existe pas
      // encore ».
      const scope = combinedScopeFrom(runtime, model, { locals: event.locals });
      const pk = primaryKeyOf(model);
      const hidden = runtime.hiddenFieldsOf(model);
      let rowsRead: Record<string, unknown>[];
      try {
        rowsRead = await runtime.adapter.data.findMany(model, {
          filter: scope as Filter | undefined,
          orderBy: widget.orderBy,
          take: widget.limit
        });
      } catch (err) {
        rowsRead = missingTableFallback(err, []);
      }
      loaded.push({
        type: 'recent',
        title: widget.title,
        href: widget.href,
        items: rowsRead.map((row) => ({
          // Rédigé AVANT de résoudre le libellé : sans ça, un champ masqué ou
          // sensible pourrait devenir le texte affiché.
          label: runtime.resolveLabel(model, redactForAudit(row, model, hidden)),
          href: `${widget.href}/${row[pk]}`
        }))
      });
      continue;
    }

    const cards = await Promise.all(
      widget.modelNames.map(async (name) => {
        // Non-null par construction : `resolveDashboard` a refusé au boot
        // tout nom absent de `runtime.models`.
        const model = runtime.models.find((m) => m.name === name)!;
        const segment = model.name.toLowerCase();
        return {
          name: model.name,
          label: runtime.labelOf(model),
          count: await countOf(model),
          href: `${runtime.basePath}/${segment}`,
          newHref: `${runtime.basePath}/${segment}/new`
        };
      })
    );
    loaded.push(
      widget.title === undefined
        ? { type: 'models', cards }
        : { type: 'models', title: widget.title, cards }
    );
  }

  return { title, subtitle, rows: groupWidgetRows(loaded) };
}
