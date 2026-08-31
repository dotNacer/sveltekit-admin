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
import { modelScopeFrom, type AdminRuntime } from './runtime.js';
import type { Model } from './types/schema.js';
import { buildWhere, parseListQuery, type ListQuery } from './query/listQuery.js';
import type { Filter } from './adapters/types.js';

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
    };

export type ResolvedWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; modelNames: string[] }
  | { type: 'count'; modelName: string; label: string; query: ListQuery; href: string };

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

export type LoadedWidget =
  | { type: 'stats'; models: number; total: number }
  | { type: 'models'; title?: string; cards: ModelCardData[] }
  | { type: 'count'; label: string; value: number; href: string };

export type DashboardRow =
  | { kind: 'cards'; cards: DashboardCard[] }
  | { kind: 'models'; title?: string; cards: ModelCardData[] };

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
    const cards = cardsOf(widget);
    const last = rows[rows.length - 1];
    if (last && last.kind === 'cards') last.cards.push(...cards);
    else rows.push({ kind: 'cards', cards });
  }
  return rows;
}

// `Exclude<..., { type: 'models' }>` : seul le widget « models » n'est pas
// carte. Quand une future tâche ajoutera d'autres variantes en cartes, ce
// type et ce switch grandiront avec elles — pas de branche pour un widget
// qui n'existe pas encore.
function cardsOf(widget: Exclude<LoadedWidget, { type: 'models' }>): DashboardCard[] {
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
 * `modelScopeFrom` est appelé HORS du `try/catch` : il lève volontairement sur
 * un scope qui échouerait ouvert (`{}`), et cette erreur-là ne doit jamais être
 * confondue avec « la table n'existe pas encore ». `countRecords` n'est pas
 * `async` (voir `adapters/prisma/dataAdapter.ts`) : un driver qui lève de
 * façon SYNCHRONE — ex. table absente — le ferait avant qu'un `.catch()`
 * puisse s'attacher. L'IIFE `async` capture ce cas comme le rejet asynchrone.
 */
function makeCounter(runtime: AdminRuntime, locals: unknown) {
  const cache = new Map<string, Promise<number>>();
  return (model: Model): Promise<number> => {
    const hit = cache.get(model.name);
    if (hit) return hit;
    const scope = modelScopeFrom(runtime, model, { locals });
    const pending = (async () => {
      try {
        return await runtime.adapter.data.countRecords(model, scope);
      } catch {
        // modèle absent de la base
        return 0;
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
      // `modelScopeFrom` reste HORS du `try/catch` : il lève volontairement
      // sur un scope qui échouerait ouvert (`{}`), et cette erreur-là ne doit
      // jamais être confondue avec « la table n'existe pas encore ».
      const scope = modelScopeFrom(runtime, model, { locals: event.locals });
      // `caseInsensitiveSearch` est faux ici comme dans la branche liste :
      // c'est le compilateur de l'adapter qui décide de la casse.
      const filter = buildWhere(widget.query, scope, false, model) as Filter | undefined;
      let value: number;
      try {
        value = await runtime.adapter.data.countRecords(model, filter);
      } catch {
        // modèle absent de la base, ou requête filtrée invalide côté driver
        value = 0;
      }
      loaded.push({ type: 'count', label: widget.label, value, href: widget.href });
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
