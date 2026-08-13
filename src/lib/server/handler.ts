/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { render } from 'svelte/server';
import { type PrismaModel, isSensitiveFieldName } from './introspection/parser.js';
import type { Schema } from './types/schema.js';
import { buildRelationGraph, type RelationGraph } from './introspection/relations.js';
import { parseRoute } from './router.js';
import {
  primaryKeyOf,
  coerceId,
  formDataToPrisma,
  paginate
} from './data.js';
import {
  parseListQuery,
  buildWhere,
  resolveSearchFields
} from './query/listQuery.js';
import { createPrismaIntrospector } from './adapters/prisma/introspector.js';
import { createPrismaDataAdapter } from './adapters/prisma/dataAdapter.js';
import { resolveCaseInsensitiveSearch } from './adapters/prisma/index.js';
import type { DataAdapter, SchemaIntrospector } from './adapters/types.js';
import { resolveListFilters, validateListFilterConfig, findFkEdge } from './query/filterDetection.js';
import { escapeHtml, toLabel } from './views/html.js';
import NotFound from './views/NotFound.svelte';
import Layout from './views/Layout.svelte';
import Dashboard from './views/Dashboard.svelte';
import Form from './views/Form.svelte';
import List from './views/List.svelte';
import type { ViewModel } from './views/types.js';

const PER_PAGE = 20;

export interface AdminHandlerConfig {
  /**
   * Prisma client instance. Required unless `adapter` is provided directly —
   * exactly one of the two must be set. Kept required-looking here (not `?`)
   * for source compatibility with every existing call site; passing neither
   * throws at handler-creation time (see the boot block).
   */
  prisma?: any;
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
  /**
   * Explicit adapter, built via `createPrismaAdapter(...)` (or, in a future
   * release, a Drizzle/other adapter). Takes priority over `prisma`/
   * `prismaSchemaPath` when both are somehow set. Most consumers never touch
   * this — passing `prisma`/`prismaSchemaPath` builds one internally.
   */
  adapter?: { introspector: SchemaIntrospector; data: DataAdapter };
  /** Base path for admin routes (default: /admin) */
  basePath?: string;
  /** Authentication check - return true if user can access admin */
  authCheck?: (event: any) => boolean | Promise<boolean>;
  /**
   * Logout logic — same "bring your own auth" philosophy as `authCheck`:
   * this library has no session system of its own, so it can't know how
   * to clear yours (a cookie, a Lucia/Better-Auth/Auth.js call, whatever).
   * You provide the side effect (clear the cookie, invalidate the
   * session...); the handler wires it to a POST-only route and a sidebar
   * button. No button is rendered at all if this isn't set — an admin
   * with no `logout` configured looks exactly as it did before this
   * option existed.
   *
   * POST-only, never a bare link: logging out must never be triggerable
   * by a GET (a crawler, a link prefetch, `<img src>`), which a plain
   * `<a href="/admin/_logout">` would allow. Runs BEFORE `authCheck` — a
   * user whose session already expired (so `authCheck` would now reject
   * them) must still be able to hit the logout route to clean up
   * client-side state (e.g. clear a stale cookie) without being stuck
   * behind a 401 first.
   */
  logout?: (event: any) => void | Promise<void>;
  /** Where to redirect after logout (default: '/') */
  logoutRedirectTo?: string;
  /** Per-model configuration */
  models?: Record<string, {
    hidden?: string[];
    readonly?: string[];
    listFields?: string[];
    label?: string;
    /**
     * Scoping `where` applied to the LIST VIEW ONLY of this model
     * (search, sidebar filters, FK filter, pagination count) — composed
     * via `AND` with active filters, never a spread (docs/design
     * §0.c/§5.2). Deliberately named `listWhere`, not `where`: a bare
     * `where` invites a developer to believe it scopes every operation
     * on the model (detail view, edit, delete, dashboard counts), which
     * it does NOT — those have no equivalent scoping in this version and
     * remain fully open regardless of this config (a real risk found in
     * review: a multi-tenant app that relies on `listWhere` alone gets a
     * false sense of safety while `getRecord`/`updateRecord`/
     * `deleteRecord` stay unscoped for anyone who obtains a row's ID
     * through another channel — a referrer, a log line, or straight
     * enumeration on a model with an Int primary key).
     *
     * Without this scope, the FK filter this feature adds makes
     * cross-tenant row discovery through the list trivial: `?f.authorId=
     * 1..N` used to return another tenant's row (its label stayed
     * protected via `relations[x].where`, §6.3.b, but the row itself did
     * not). This config closes that specific hole for the list — nothing
     * more. If you need every view scoped, you currently have to wire
     * `relations[x].where` for the active-FK-label lookup separately
     * (they are NOT the same function and are NOT automatically kept in
     * sync), and there is no scoping hook at all yet for
     * detail/edit/delete/dashboard — track that as a real gap, not an
     * oversight to work around silently.
     *
     * A scope function that returns `{}` (e.g. because `locals.userId`
     * was undefined after a session expired) is NOT treated as "no
     * scope" — `{}` would silently fail open (an intersection with an
     * empty clause matches everything) exactly when a caller most needs
     * protection. It throws instead: fail loud on a misbehaving scope
     * function, never fail open on a data leak.
     */
    listWhere?: (ctx: { locals?: any }) => Record<string, unknown>;
    relations?: Record<string, {
      widget?: 'select' | 'raw-id' | 'hidden';
      labelTemplate?: string;
      orderBy?: Record<string, 'asc' | 'desc'>;
      where?: (ctx: { locals?: any }) => Record<string, unknown>;
      nullLabel?: string;
    }>;
    /**
     * Champs interrogés par la barre de recherche texte libre. Sans
     * config, une heuristique conservatrice reprend `relationDefaults.labelFields`
     * parmi les champs String non sensibles (voir docs/design/list-search-filters.md §2.1).
     * Une config explicite gagne toujours et n'est jamais tronquée par
     * l'heuristique — un champ non filtrable au sens de `isFilterableFieldType`
     * (relation, liste, Json, Bytes) ou sensible (password/hash/secret/token)
     * y est silencieusement ignoré.
     */
    searchFields?: string[];
    /**
     * Champs filtrables via la sidebar de la liste. Config explicite
     * (forme courte `'published'` ou objet `{ field, label }`) — sinon
     * une heuristique auto-détecte les champs Boolean et enum uniquement
     * (domaine de valeurs connu statiquement, zéro requête pour rendre la
     * sidebar ; voir docs/design/list-search-filters.md §3.5). Une config
     * invalide (champ inexistant, sensible, relation, type non supporté)
     * lève une erreur au démarrage — c'est une erreur de développeur, elle
     * doit échouer fort plutôt que produire un filtre silencieusement mort.
     */
    listFilter?: import('./query/filterDetection.js').ListFilterConfigEntry[];
  }>;
  /** Models to exclude from admin */
  exclude?: string[];
  /** Hide pivot/junction tables automatically (default: true) */
  hidePivotTables?: boolean;
  /** Relation defaults */
  relationDefaults?: {
    /** Au-delà de ce nombre d'options, une FK est rendue en raw-id (default: 200) */
    selectThreshold?: number;
    /** Champs candidats pour le label, dans l'ordre de préférence */
    labelFields?: string[];
  };
  /**
   * Défauts pour la sidebar de filtres (listFilter).
   * `linkThreshold`: en dessous ou égal à ce nombre d'options, un filtre FK
   * est rendu en liens dans la sidebar ; au-dessus (et ≤ relationDefaults.selectThreshold),
   * en `<select>` dans un mini form GET (docs/design/list-search-filters.md §3.2).
   * `autoDetect`: auto-détection des champs Boolean/enum quand pas de config
   * `listFilter` explicite (default: true).
   */
  listFilterDefaults?: {
    linkThreshold?: number;
    autoDetect?: boolean;
  };
  /**
   * Recherche texte libre : configuration globale.
   * `mode`: 'auto' détecte le provider du schéma et n'émet `mode: 'insensitive'`
   * que sur postgresql/cockroachdb/mongodb (les seuls où Prisma le supporte —
   * l'émettre sur sqlite/mysql/sqlserver lève une erreur Prisma). 'insensitive'
   * et 'default' forcent le comportement, pour un provider non détectable
   * (`provider = env(...)`) ou un besoin spécifique (index `citext`, etc.).
   * Voir docs/design/list-search-filters.md §2.5.
   */
  search?: {
    mode?: 'auto' | 'insensitive' | 'default';
  };
  /** Custom branding */
  branding?: {
    title?: string;
    primaryColor?: string;
  };
}

// ============================================
// Main Handler
// ============================================

export function createAdminHandler(config: AdminHandlerConfig) {
  const {
    prisma,
    prismaSchemaPath = './prisma/schema.prisma',
    basePath = '/admin',
    authCheck,
    logout,
    logoutRedirectTo = '/',
    exclude = [],
    hidePivotTables = true,
    models: modelsConfig = {}
  } = config;

  if (!config.adapter && !prisma) {
    throw new Error(
      '[sveltekit-admin] createAdminHandler requires either `prisma` (with optional `prismaSchemaPath`) or `adapter` — neither was provided.'
    );
  }

  const introspector: SchemaIntrospector =
    config.adapter?.introspector ?? createPrismaIntrospector({ schemaPath: prismaSchemaPath });

  // Introspect the schema once at startup — same failure handling as before:
  // a broken/missing schema source degrades to "no models known" rather than
  // throwing out of `createAdminHandler` itself.
  let schema: Schema | null = null;
  let relationGraph: RelationGraph | null = null;
  try {
    const introspected = introspector.introspect();
    if (introspected instanceof Promise) {
      throw new Error(
        '[sveltekit-admin] SchemaIntrospector.introspect() returned a Promise — ' +
          'createAdminHandler only supports synchronous introspection today.'
      );
    }
    schema = introspected;
    relationGraph = buildRelationGraph(schema);
    for (const d of relationGraph.diagnostics) {
      console.warn(`[sveltekit-admin] ${d}`);
    }
  } catch (e) {
    console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
  }

  const filteredModels = schema?.models.filter((m) => {
    // Exclude explicitly excluded models
    if (exclude.includes(m.name)) return false;
    // Exclude pivot tables if option is enabled
    if (hidePivotTables && m.isPivotTable) return false;
    return true;
  }) || [];

  // Valider `listFilter` au démarrage : une config invalide (champ
  // inexistant, sensible, relation, type non supporté) doit échouer fort
  // ici plutôt que produire silencieusement un filtre mort à chaque rendu
  // de liste (docs/design §8, même politique que le groupe ambigu de
  // relations.ts).
  const hiddenFieldsOf = (m: PrismaModel): Set<string> =>
    new Set(modelsConfig[m.name]?.hidden ?? []);

  for (const m of filteredModels) {
    const entries = modelsConfig[m.name]?.listFilter;
    // Non-null par construction : `filteredModels` n'existe que si le schéma
    // a été parsé, et le graphe est construit dans la même branche de boot.
    if (entries) validateListFilterConfig(m.name, entries, m, relationGraph!, hiddenFieldsOf(m));
  }

  const labelOf = (m: PrismaModel) => modelsConfig[m.name]?.label || toLabel(m.name);
  const modelList = filteredModels.map((m) => ({ name: m.name, label: labelOf(m) }));
  const findModel = (name?: string) =>
    filteredModels.find((m) => m.name.toLowerCase() === name?.toLowerCase());
  const viewModel = (m: PrismaModel): ViewModel => ({
    name: m.name,
    label: labelOf(m),
    fields: m.fields,
    primaryKey: primaryKeyOf(m),
    // Non-null par construction : `m` vient toujours de `filteredModels`,
    // dérivé du schéma qu'on vient de parser avec succès.
    relationGraph: relationGraph!
  });
  const redirectToList = (model: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${basePath}/${model.toLowerCase()}` }
    });

  const selectThreshold = config.relationDefaults?.selectThreshold ?? 200;
  const filterLinkThreshold = config.listFilterDefaults?.linkThreshold ?? 20;
  const labelFieldCandidates = config.relationDefaults?.labelFields ?? [
    'name', 'title', 'label', 'email', 'username', 'slug'
  ];

  // `mode: 'insensitive'` n'est supporté par Prisma que sur
  // postgresql/cockroachdb/mongodb — l'émettre sur sqlite/mysql/sqlserver
  // lève une erreur Prisma dure. Détection auto via le provider extrait du
  // schéma ; `search.mode` permet de forcer le comportement (provider non
  // littéral dans le schéma, index citext, etc.). Voir docs/design §2.5.
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(schema, config.search?.mode);

  const adapter: { introspector: SchemaIntrospector; data: DataAdapter } =
    config.adapter ?? { introspector, data: createPrismaDataAdapter(prisma, { caseInsensitiveSearch }) };

  /**
   * Champs qu'un `?f.<field>=` est autorisé à cibler pour ce modèle : tout
   * champ scalaire non-liste, non-relation, de type filtrable
   * (String/Int/Float/Decimal/BigInt/Boolean/DateTime/enum — donc pas
   * Json/Bytes), non sensible, et non listé dans `hidden` pour ce modèle.
   * Sans ce dernier point, `hidden: ['internalNotes']` ne fait que masquer
   * l'affichage : le champ reste un oracle de confirmation de valeur via
   * `?f.internalNotes=...contains...`, exactement la faille §0.a fermée
   * ailleurs pour les champs sensibles par nom — `hidden` et le prédicat
   * de sensibilité sont deux sources distinctes, toutes deux doivent
   * fermer l'oracle (docs/design §10, "deux sources, un seul prédicat
   * partagé, sinon divergence garantie"). Défense en profondeur :
   * `listQuery.ts` revérifie lui-même la sensibilité par nom, ce set est
   * la première passe et la seule à connaître la config `hidden`.
   */
  const resolveFilterableFields = (model: PrismaModel): Set<string> => {
    const hidden = hiddenFieldsOf(model);
    const out = new Set<string>();
    for (const f of model.fields) {
      if (f.relation || f.isList) continue;
      if (['Json', 'Bytes'].includes(f.type)) continue;
      if (isSensitiveFieldName(f.name)) continue;
      if (hidden.has(f.name)) continue;
      out.add(f.name);
    }
    return out;
  };

  /**
   * Résout le label BRUT (non échappé) d'une ligne : premier champ String
   * candidat présent, sinon template `{a} {b}` si configuré, sinon la PK.
   * Déterministe. Svelte échappe automatiquement à l'interpolation dans les
   * composants — pas besoin d'échapper ici.
   */
  const resolveLabel = (
    targetModel: PrismaModel,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string => {
    if (labelTemplate) {
      return labelTemplate.replace(/\{(\w+)\}/g, (_, k) => String(row[k] ?? ''));
    }
    for (const candidate of labelFieldCandidates) {
      const field = targetModel.fields.find((f) => f.name === candidate);
      if (field && field.type === 'String' && row[candidate] != null) {
        return String(row[candidate]);
      }
    }
    return String(row[primaryKeyOf(targetModel)]);
  };

  /**
   * Charge les options pour toutes les arêtes to-one-owning et m2m-implicite
   * d'un modèle. Une requête COUNT par relation avant le findMany : évite de
   * charger 10k lignes pour découvrir qu'il y en a 10k.
   */
  const loadRelationOptions = async (
    model: PrismaModel,
    ctx: { locals?: any },
    currentId?: string
  ): Promise<Map<string, import('./views/types.js').RelationMeta>> => {
    const edges = [...relationGraph!.edges.values()].filter((edge) => {
      if (edge.model !== model.name) return false;
      if (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m-implicit') return false;
      if (edge.unsupported) return false;
      const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
      return relConfig?.widget !== 'hidden';
    });

    // Une relation ne dépend pas de l'autre : chargées en parallèle plutôt
    // qu'en série (un modèle avec N relations ne doit pas payer N
    // aller-retours DB empilés pour afficher un seul formulaire).
    const entries = await Promise.all(
      edges.map(async (edge): Promise<[string, import('./views/types.js').RelationMeta]> => {
        const key = `${edge.model}.${edge.field}`;
        const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
        const targetModel = schema!.models.find((m) => m.name === edge.target)!;
        const filter = relConfig?.where ? (relConfig.where(ctx) as any) : undefined;

        try {
          const total = await adapter.data.countRecords(targetModel, filter);
          if (total > selectThreshold || relConfig?.widget === 'raw-id') {
            const selectedIds =
              edge.kind === 'm2m-implicit' && currentId
                ? await adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId)
                : undefined;
            return [key, { tooMany: true, options: [], selectedIds }];
          }

          const rows = await adapter.data.findMany(targetModel, { filter, orderBy: relConfig?.orderBy });
          const options = rows.map((row) => ({
            id: row[primaryKeyOf(targetModel)] as string | number,
            label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
          }));
          const selectedIds =
            edge.kind === 'm2m-implicit' && currentId
              ? await adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId)
              : undefined;
          return [key, { tooMany: false, options, selectedIds }];
        } catch {
          // Cible absente de la base ou client incomplet : repli raw-id pour
          // garder le champ éditable plutôt que de faire échouer tout le form.
          return [key, { tooMany: true, options: [] }];
        }
      })
    );
    return new Map(entries);
  };

  /**
   * Options d'un filtre FK : charge et scope les valeurs possibles pour la
   * sidebar, ET résout le label du chip actif. Doctrine IDOR (docs/design
   * §6.3) : les options ET le label du chip passent par le `where` de
   * scoping de la relation — un chip forgé avec un ID hors scope affiche
   * l'ID brut, jamais le label (sinon c'est un oracle sur le nom d'un
   * enregistrement d'un autre tenant).
   */
  const resolveFkFilterOptions = async (
    model: PrismaModel,
    fkFieldName: string,
    label: string,
    ctx: { locals?: any },
    activeRawValue: string | undefined
  ): Promise<import('./views/types.js').FkFilterMeta> => {
    // Appelé uniquement pour un filtre `kind: 'fk'` retourné par
    // resolveListFilters avec CE MÊME graphe : graphe et arête existent donc
    // par construction. Garder des gardes here masquerait une incohérence
    // interne et ajouterait du code mort (coverage artificielle).
    const edge = findFkEdge(relationGraph!, model.name, fkFieldName)!;

    const targetModel = schema!.models.find((m) => m.name === edge.target)!;
    // Non-null par construction : `edge` vient du graphe dérivé du même
    // schéma parsé avec succès — une arête ne peut pas cibler un modèle qui
    // n'existe pas dans `schema.models`.

    const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
    const scope = relConfig?.where ? (relConfig.where(ctx) as any) : undefined;

    // Options de la sidebar (comptées puis chargées si sous le seuil) et
    // label du chip actif (§6.3.b) sont deux requêtes indépendantes — l'une
    // ne dépend pas du résultat de l'autre — donc en parallèle plutôt qu'en
    // série.
    const loadOptions = async (): Promise<{
      options: { id: string | number; label: string }[];
      tooMany: boolean;
    }> => {
      try {
        const total = await adapter.data.countRecords(targetModel, scope);
        if (total > selectThreshold) {
          return { options: [], tooMany: true };
        }
        const rows = await adapter.data.findMany(targetModel, { filter: scope, orderBy: relConfig?.orderBy });
        const options = rows.map((row) => ({
          id: row[primaryKeyOf(targetModel)] as string | number,
          label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
        }));
        return { options, tooMany: false };
      } catch {
        return { options: [], tooMany: true };
      }
    };

    // Un ID hors scope retourne null ici → le composant affiche l'ID brut,
    // jamais le label (sinon c'est un oracle sur le nom d'un enregistrement
    // d'un autre tenant).
    const loadActiveLabel = async (): Promise<string | undefined> => {
      if (activeRawValue === undefined) return undefined;
      const activeId = coerceId(activeRawValue, targetModel);
      try {
        const idFilter = { op: 'eq', field: primaryKeyOf(targetModel), value: activeId } as const;
        const filter = scope ? ({ op: 'and', clauses: [idFilter, scope] } as any) : idFilter;
        const row = await adapter.data.findFirst(targetModel, filter);
        return row ? resolveLabel(targetModel, row, relConfig?.labelTemplate) : undefined;
      } catch {
        return undefined;
      }
    };

    const [{ options, tooMany }, activeLabel] = await Promise.all([loadOptions(), loadActiveLabel()]);

    return {
      field: fkFieldName,
      label,
      relationField: edge.field,
      targetModel: edge.target,
      options,
      mode: tooMany ? 'raw-id' : options.length <= filterLinkThreshold ? 'links' : 'select',
      tooMany,
      activeLabel,
      // Une cible exclue/masquée n'a pas de page admin : le chip reste du
      // texte, jamais un lien mort (docs/design §6.4).
      activeHref:
        activeLabel && findModel(edge.target)
          ? `${basePath}/${edge.target.toLowerCase()}/${encodeURIComponent(activeRawValue!)}`
          : undefined
    };
  };

  /**
   * Compte, pour chaque relation inverse (1-N, 1-1) d'un modèle, le nombre
   * d'enregistrements liés côté cible. Résilient : une cible dont le client
   * échoue (mock partiel, modèle absent) retombe sur 0 plutôt que de casser
   * le rendu du formulaire.
   */
  const loadRelatedCounts = async (
    model: PrismaModel,
    currentId: string
  ): Promise<Map<string, number>> => {
    const edges = [...relationGraph!.edges.values()].filter(
      (edge) => edge.model === model.name && (edge.kind === 'to-many-inverse' || edge.kind === 'to-one-inverse')
    );

    // Un count par relation inverse, indépendants entre eux : en parallèle
    // plutôt qu'empilés un par un (même raisonnement que loadRelationOptions).
    const entries = await Promise.all(
      edges.map(async (edge): Promise<[string, number] | undefined> => {
        const owning = [...relationGraph!.edges.values()].find(
          (o) => o.model === edge.target && o.kind === 'to-one-owning' && o.relationName === edge.relationName
        );
        if (!owning || owning.unsupported) return undefined;

        const scalarName = owning.scalarFields[0];
        const key = `${edge.model}.${edge.field}`;
        const targetModel = schema!.models.find((m) => m.name === edge.target)!;
        try {
          const count = await adapter.data.countRecords(targetModel, {
            op: 'eq',
            field: scalarName,
            value: coerceId(currentId, model)
          });
          return [key, count];
        } catch {
          return [key, 0];
        }
      })
    );
    return new Map(entries.filter((e): e is [string, number] => e !== undefined));
  };

  /**
   * Endpoint de recherche `GET {basePath}/_search?rel=Model.field&q=...&page=N`.
   * Sert les options d'une relation to-one-owning ou m2m-implicite en JSON
   * paginé — la voie prévue pour un futur widget autocomplete côté client
   * quand le nombre d'options dépasse `selectThreshold`. Respecte le `where`
   * de scoping configuré sur la relation, comme le select et la validation
   * POST : même garantie anti-IDOR sur les trois chemins.
   */
  const handleSearch = async (event: any): Promise<Response> => {
    const relParam = event.url.searchParams.get('rel') ?? '';
    const [modelName, fieldName] = relParam.split('.');
    const q = event.url.searchParams.get('q') ?? '';
    const { page } = paginate(event.url.searchParams.get('page'), PER_PAGE);

    const model = findModel(modelName);
    const edge = model && relationGraph
      ? relationGraph.edges.get(`${model.name}.${fieldName}`)
      : undefined;

    if (!model || !edge || (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m-implicit') || edge.unsupported) {
      return new Response(JSON.stringify({ error: 'unknown relation' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const targetModel = schema!.models.find((m) => m.name === edge.target)!;
    const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
    const configWhere = relConfig?.where ? relConfig.where({ locals: event.locals }) : {};

    // Recherche sur le premier champ String candidat du modèle cible — le
    // même champ que celui utilisé pour construire le label par défaut.
    const searchField = labelFieldCandidates.find((c) =>
      targetModel.fields.some((f) => f.name === c && f.type === 'String')
    );
    // `contains` passed as a raw Prisma object literal here (not a `Filter`
    // leaf) is deliberate: `compileFilterToPrismaWhere` only adds
    // `mode: 'insensitive'` for a `{ op: 'contains', ... }` leaf, which would
    // make this endpoint's case-sensitivity depend on the adapter-wide
    // `caseInsensitiveSearch` setting — this endpoint was always
    // case-sensitive regardless of provider, and must stay that way (zero
    // observable behavior change is a hard constraint of this refactor).
    // `compile()` treats any node without a recognized `op` key as an opaque
    // pass-through, so this raw object flows through unchanged, exactly like
    // `configWhere` already does.
    const searchFilter: any =
      q && searchField
        ? { op: 'and', clauses: [configWhere, { [searchField]: { contains: q } }] }
        : configWhere;

    try {
      const total = await adapter.data.countRecords(targetModel, searchFilter);
      const rows = await adapter.data.findMany(targetModel, {
        filter: searchFilter,
        orderBy: relConfig?.orderBy,
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE
      });
      const options = rows.map((row) => ({
        id: row[primaryKeyOf(targetModel)],
        label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
      }));
      return new Response(JSON.stringify({ options, total, page }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'search failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  return async ({
    event,
    resolve
  }: {
    event: any;
    resolve: (event: any) => Response | Promise<Response>;
  }) => {
    const { pathname } = event.url;

    // Only handle admin routes
    if (!pathname.startsWith(basePath)) {
      return resolve(event);
    }

    const route = parseRoute(pathname, basePath);

    // Logout: dispatched BEFORE authCheck, deliberately. A user whose
    // session already expired (authCheck would now reject them) must
    // still be able to hit this route to clear client-side state (a
    // stale cookie, for instance) instead of being stuck behind a 401
    // with no way to reach the very thing that would let them log back
    // in cleanly. POST-only: a GET (crawler, link prefetch, <img src>)
    // must never be able to trigger a logout side effect.
    if (route.view === 'logout') {
      if (event.request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      if (logout) {
        await logout(event);
      }
      return new Response(null, { status: 303, headers: { Location: logoutRedirectTo } });
    }

    // Auth check
    if (authCheck) {
      const allowed = await authCheck(event);
      if (!allowed) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    let content = '';
    let currentModel: string | undefined;

    if (route.view === 'search') {
      return handleSearch(event);
    }

    try {
      // Handle POST requests (create, update, delete). Unrecognised actions fall
      // through to the GET rendering below, as they always have.
      if (event.request.method === 'POST') {
        const formData = await event.request.formData();
        const action = formData.get('_action');

        if (route.model) {
          const model = findModel(route.model);
          if (!model) {
            throw new Error(`Model "${route.model}" not found`);
          }

          if (action === 'delete' && route.id) {
            await adapter.data.deleteRecord(model, route.id);
            return redirectToList(route.model);
          }

          if (action === 'create' || action === 'update') {
            const data = formDataToPrisma(formData, model);
            const m2mInput: Record<string, { targetPkField: string; ids: Array<string | number> }> = {};

            // Validation des FK owning : coercion + existence + self-ref.
            // Rejoue le `where` de scoping : un ID hors du where est rejeté,
            // pas seulement caché du select (IDOR par POST forgé).
            if (relationGraph) {
              for (const edge of relationGraph.edges.values()) {
                if (edge.model !== model.name || edge.kind !== 'to-one-owning') continue;
                if (edge.unsupported) continue;

                const scalarName = edge.scalarFields[0]!;
                // Lu directement depuis le FormData plutôt que `data` :
                // `formDataToPrisma` omet la clé pour un scalaire required
                // laissé vide, donc `data[scalarName]` ne suffirait pas ici.
                const raw = formData.get(scalarName);
                if (raw === null) continue;

                const relConfig = modelsConfig[model.name]?.relations?.[edge.field];

                // Vide sur relation optionnelle → null (disconnect).
                if (raw === '' || raw === undefined || raw === null) {
                  if (edge.isRequired) {
                    throw new Error(`${edge.field} is required`);
                  }
                  data[scalarName] = null;
                  continue;
                }

                // Coercion vers le type de la PK cible. `targetModel` existe
                // toujours : le graphe n'aurait pas produit d'arête sinon.
                const targetModel = schema!.models.find((m) => m.name === edge.target)!;
                const pkField = targetModel.fields.find((f) => f.isId);
                const coerced = pkField?.type === 'Int' ? parseInt(String(raw)) : String(raw);
                if (pkField?.type === 'Int' && !Number.isSafeInteger(coerced)) {
                  throw new Error(`${edge.field}: invalid id`);
                }

                // Self-ref : la ligne courante ne peut pas être sa propre cible.
                if (edge.selfReferential && route.id && String(coerced) === String(coerceId(route.id, model))) {
                  throw new Error(`${edge.field}: cannot reference itself`);
                }

                // Existence + scoping. findFirst et non findUnique : le where
                // peut porter des conditions arbitraires (scoping multi-tenant).
                // Si le client ne sait pas répondre, on ne bloque pas l'écriture.
                try {
                  const idFilter = { op: 'eq' as const, field: primaryKeyOf(targetModel), value: coerced };
                  const scopeFilter = relConfig?.where ? (relConfig.where({ locals: event.locals }) as any) : undefined;
                  const filter = scopeFilter ? ({ op: 'and', clauses: [idFilter, scopeFilter] } as any) : idFilter;
                  const found = await adapter.data.findFirst(targetModel, filter);
                  if (!found) {
                    throw new Error(`${edge.field}: invalid value`);
                  }
                } catch (e: any) {
                  if (e?.message?.includes('invalid value')) throw e;
                  // Client incapable de vérifier (mock partiel, etc.) : on laisse passer.
                }

                data[scalarName] = coerced;
              }

              // N-N implicite : lit `__rel__<field>` (valeurs cochées) et
              // `__rel_present__<field>` (sentinelle). Sans le sentinelle,
              // le champ est absent du form (readonly/exclu) → no-op.
              // Avec le sentinelle mais zéro valeur cochée → vider la
              // relation (`set: []` / rien à connecter en création).
              for (const edge of relationGraph.edges.values()) {
                if (edge.model !== model.name || edge.kind !== 'm2m-implicit') continue;
                // Pas de garde `edge.unsupported` ici : par construction du
                // graphe, `unsupported` n'est jamais posé sur une arête
                // m2m-implicite (seulement sur to-one-owning / groupes
                // ambigus, qui retombent toujours en to-one-owning).

                const present = formData.get(`__rel_present__${edge.field}`);
                if (present === null) continue;

                const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
                const targetModel = schema!.models.find((m) => m.name === edge.target)!;
                const targetPk = primaryKeyOf(targetModel);
                const pkIsInt = targetModel.fields.find((f) => f.isId)?.type === 'Int';

                const submitted = formData.getAll(`__rel__${edge.field}`).map(String);
                const rawIds: string[] =
                  submitted.length === 1 && submitted[0].includes(',')
                    ? submitted[0].split(',').map((s: string) => s.trim()).filter(Boolean)
                    : submitted;

                const ids: (string | number)[] = rawIds.map((v: string) =>
                  pkIsInt ? parseInt(v) : v
                );
                if (pkIsInt && ids.some((v) => !Number.isSafeInteger(v))) {
                  throw new Error(`${edge.field}: invalid id`);
                }

                // Existence + scoping en une requête, sur l'ensemble des IDs
                // soumis. Un compte différent = au moins un ID invalide ou
                // hors scoping — IDOR bloqué au même titre que pour les FK.
                if (ids.length > 0) {
                  const inFilter = { op: 'in' as const, field: targetPk, value: ids };
                  const scopeFilter = relConfig?.where ? (relConfig.where({ locals: event.locals }) as any) : undefined;
                  const filter = scopeFilter ? ({ op: 'and', clauses: [inFilter, scopeFilter] } as any) : inFilter;
                  try {
                    const found = await adapter.data.findMany(targetModel, { filter });
                    if (found.length !== new Set(ids.map(String)).size) {
                      throw new Error(`${edge.field}: invalid value`);
                    }
                  } catch (e: any) {
                    if (e?.message?.includes('invalid value')) throw e;
                    // Client incapable de vérifier : on laisse passer.
                  }
                }

                m2mInput[edge.field] = { targetPkField: targetPk, ids };
              }
            }

            if (action === 'create') {
              await adapter.data.createRecord(model, { scalars: data, m2m: m2mInput });
            } else if (route.id) {
              await adapter.data.updateRecord(model, route.id, { scalars: data, m2m: m2mInput });
            }

            return redirectToList(route.model);
          }
        }
      }

      // GET requests - render views
      if (route.view === 'notFound') {
        content = render(NotFound, { props: { message: 'Page not found', basePath } }).body;
      } else if (route.view === 'dashboard') {
        const modelsWithCounts = await Promise.all(
          filteredModels.map(async (m) => {
            let count = 0;
            try {
              count = await adapter.data.countRecords(m);
            } catch {
              // model absent from the database
            }
            return { name: m.name, label: labelOf(m), count };
          })
        );

        const totalRecords = modelsWithCounts.reduce((sum, m) => sum + m.count, 0);

        content = render(Dashboard, {
          props: {
            models: modelsWithCounts,
            stats: { total: totalRecords, models: modelsWithCounts.length },
            basePath
          }
        }).body;
      } else if (route.model) {
        currentModel = route.model;
        const model = findModel(route.model);

        if (!model) {
          content = render(NotFound, {
            props: { message: `Model "${route.model}" not found`, basePath }
          }).body;
        } else if (route.view === 'list') {
          const { page } = paginate(event.url.searchParams.get('page'), PER_PAGE);
          const modelSearchConfig = modelsConfig[model.name]?.searchFields;
          const searchFields = resolveSearchFields(model, modelSearchConfig, labelFieldCandidates, hiddenFieldsOf(model));
          const filterableFields = resolveFilterableFields(model);
          const listQuery = parseListQuery(
            event.url.searchParams,
            model,
            schema!.enums,
            searchFields,
            filterableFields
          );
          const listScope = modelsConfig[model.name]?.listWhere?.({ locals: event.locals });
          // A scope function returning `{}` (falsy-looking but truthy as
          // an object) would otherwise silently fail OPEN — `{}` composed
          // into an AND matches every row, exactly the opposite of what a
          // caller configuring listWhere expects (real gap found in
          // review: `locals.userId` undefined after a session expires is
          // a realistic way to hit this). Fail loud instead: a scope
          // function is either omitted entirely, or must return at least
          // one condition every time it runs.
          if (listScope && Object.keys(listScope).length === 0) {
            throw new Error(
              `[sveltekit-admin] models.${model.name}.listWhere returned an empty object ({}), ` +
                `which would silently disable list scoping (fail-open). Return undefined/omit the ` +
                `scope entirely if there is genuinely nothing to scope by for this request, or a ` +
                `condition that actually restricts rows otherwise.`
            );
          }
          const filter = buildWhere(listQuery, listScope, caseInsensitiveSearch, model) as any;
          const { rows: items, total } = await adapter.data.listRecords(model, { filter, skip: (page - 1) * PER_PAGE, take: PER_PAGE });
          const listFilters = resolveListFilters(
            model,
            schema!.enums,
            modelsConfig[model.name]?.listFilter,
            toLabel,
            relationGraph!,
            hiddenFieldsOf(model),
            config.listFilterDefaults?.autoDetect ?? true
          );
          // Un filtre FK ne dépend pas de l'autre : résolus en parallèle
          // plutôt qu'un par un (même raisonnement que loadRelationOptions).
          const fkFilterEntries = await Promise.all(
            listFilters
              .filter((filter) => filter.kind === 'fk')
              .map(async (filter): Promise<[string, import('./views/types.js').FkFilterMeta]> => {
                const activeRawValue = listQuery.filters.find(
                  (f) => f.field === filter.field && f.op === 'equals'
                )?.raw;
                const meta = await resolveFkFilterOptions(
                  model,
                  filter.field,
                  filter.label,
                  { locals: event.locals },
                  activeRawValue
                );
                return [filter.field, meta];
              })
          );
          const fkFilterMeta = new Map(fkFilterEntries);
          content = render(List, {
            props: {
              model: viewModel(model),
              items,
              pagination: { page, perPage: PER_PAGE, total },
              basePath,
              config,
              query: listQuery,
              currentUrl: event.url,
              listFilters,
              fkFilterMeta
            }
          }).body;
        } else if (route.view === 'create') {
          const relationOptions = await loadRelationOptions(model, { locals: event.locals });
          // Pré-remplissage FK depuis la query string (`?authorId=3`), posé
          // par le lien "Ajouter" du bloc de liaisons inverses.
          const prefill: Record<string, unknown> = {};
          for (const edge of relationGraph!.edges.values()) {
            if (edge.model !== model.name || edge.kind !== 'to-one-owning') continue;
            const scalarName = edge.scalarFields[0];
            const value = event.url.searchParams.get(scalarName);
            if (value !== null) prefill[scalarName] = value;
          }
          const itemPrefill = Object.keys(prefill).length > 0 ? prefill : undefined;
          content = render(Form, {
            props: {
              mode: 'create',
              model: { ...viewModel(model), relationOptions },
              basePath,
              config,
              item: itemPrefill
            }
          }).body;
        } else {
          // `route.id!` s'appuie sur un invariant de `parseRoute` : les seules vues
          // qui portent un `model` sont 'list', 'create' et 'edit', et seule 'edit'
          // atteint ce `else` — or 'edit' est la branche à 2 segments, donc `id` y est
          // toujours défini. La variante 'notFound' ne porte pas de `model` : elle est
          // interceptée en amont et ne peut pas arriver ici.
          const item = await adapter.data.getRecord(model, route.id!);
          const relationOptions = await loadRelationOptions(model, { locals: event.locals }, route.id);
          const relatedCounts = item ? await loadRelatedCounts(model, route.id!) : undefined;
          content = item
            ? render(Form, {
                props: {
                  mode: 'edit',
                  model: { ...viewModel(model), relationOptions, relatedCounts },
                  basePath,
                  config,
                  item
                }
              }).body
            : render(NotFound, {
                props: { message: `${model.name} with ID "${route.id}" not found`, basePath }
              }).body;
        }
      }
    } catch (e: any) {
      console.error('[sveltekit-admin] Error:', e);
      content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }

    const html = render(Layout, { props: { content, config, modelList, currentModel } }).body;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  };
}
