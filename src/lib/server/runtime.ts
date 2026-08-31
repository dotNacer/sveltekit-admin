import { isSensitiveFieldName } from './introspection/parser.js';
import type { Schema, Model } from './types/schema.js';
import { resolveListColumns } from './query/listColumns.js';
import { resolvePageSizes } from './query/pageSize.js';
import type { ActiveSort } from './query/sortQuery.js';
import { buildRelationGraph, type RelationGraph } from './introspection/relations.js';
import { primaryKeyOf } from './data.js';
import { validateListFilterConfig } from './query/filterDetection.js';
import { resolveSearchFields } from './query/listQuery.js';
import { isCompositeFilter, isLeafFilter, normalizeScope } from './adapters/filter.js';
import { toLabel } from './views/html.js';
import type { ViewModel } from './views/types.js';
import type { DataAdapter, SchemaIntrospector, Filter } from './adapters/types.js';
import type { AdminHandlerConfig } from './handler.js';
import { AdminConfigError } from './errors.js';
import { resolveDashboard, type ResolvedDashboard } from './dashboard.js';

export function scopeFrom(
  relConfig: { where?: (ctx: any) => any } | undefined,
  ctx: { locals?: any }
): any {
  return relConfig?.where ? normalizeScope(relConfig.where(ctx)) : undefined;
}

export function listScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any }
): Record<string, unknown> | undefined {
  const listScope = runtime.config.models?.[model.name]?.listWhere?.(ctx);
  // A scope function returning `{}` (falsy-looking but truthy as
  // an object) would otherwise silently fail OPEN — `{}` composed
  // into an AND matches every row, exactly the opposite of what a
  // caller configuring listWhere expects (real gap found in
  // review: `locals.userId` undefined after a session expires is
  // a realistic way to hit this). Fail loud instead: a scope
  // function is either omitted entirely, or must return at least
  // one condition every time it runs.
  if (listScope && Object.keys(listScope).length === 0) {
    throw new AdminConfigError(
      `[sveltekit-admin] models.${model.name}.listWhere returned an empty object ({}), ` +
        `which would silently disable list scoping (fail-open). Return undefined/omit the ` +
        `scope entirely if there is genuinely nothing to scope by for this request, or a ` +
        `condition that actually restricts rows otherwise.`
    );
  }
  return listScope;
}

export function modelScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any }
): Filter | undefined {
  const scope = runtime.config.models?.[model.name]?.scope;
  if (!scope) return undefined;
  const raw = scope(ctx);
  if (!raw || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)) {
    throw new AdminConfigError(
      `[sveltekit-admin] models.${model.name}.scope must return a non-empty condition; ` +
        'refusing to fail open.'
    );
  }
  const normalized = normalizeScope(raw);
  const valid = (node: unknown): node is Filter => {
    if (isLeafFilter(node)) return node.value !== undefined;
    return isCompositeFilter(node) && node.clauses.length > 0 && node.clauses.every(valid);
  };
  if (!valid(normalized)) {
    throw new AdminConfigError(`[sveltekit-admin] models.${model.name}.scope returned an invalid condition; refusing to fail open.`);
  }
  return normalized;
}

/**
 * `scope` (toutes les lectures) ET `listWhere` (historiquement la seule vue
 * liste), composés en AND. Le dashboard l'utilise aussi : une carte qui
 * annonce 40 quand la liste vers laquelle elle pointe en montre 12 est un
 * chiffre faux, et un widget de comptage rend cet écart visible.
 */
export function combinedScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any } // aligné sur listScopeFrom/modelScopeFrom, pas `unknown`
): Filter | Record<string, unknown> | undefined {
  // Le type de retour suit `normalizeScope` (pas juste `Filter`) : un
  // `listWhere` qui renvoie un `where` Prisma imbriqué reste opaque par
  // conception (voir le commentaire de `normalizeScope`), donc le composé
  // peut légitimement ne pas être un `Filter` strict. Forcer `Filter` ici
  // demanderait un cast qui mentirait sur ce cas réel.
  const modelScope = modelScopeFrom(runtime, model, ctx);
  const listScope = normalizeScope(listScopeFrom(runtime, model, ctx));
  if (modelScope && listScope) {
    return { op: 'and', clauses: [modelScope, listScope] };
  }
  return modelScope ?? listScope;
}

/** Extract equality predicates so create can force tenant-owned columns. */
export function modelScopeValues(runtime: AdminRuntime, model: Model, ctx: { locals?: any }): Record<string, unknown> {
  const normalized = modelScopeFrom(runtime, model, ctx);
  if (!normalized) return {};
  const values: Record<string, unknown> = {};
  const visit = (node: Filter): boolean => {
    if (isLeafFilter(node)) {
      if (node.op !== 'eq') return false;
      if (node.field in values && values[node.field] !== node.value) return false;
      values[node.field] = node.value;
      return true;
    }
    if (!isCompositeFilter(node) || node.op === 'or') return false;
    return node.clauses.every(visit);
  };
  if (!visit(normalized) || Object.keys(values).length === 0) {
    throw new AdminConfigError(`[sveltekit-admin] models.${model.name}.scope must contain only equality conditions for creation`);
  }
  return values;
}

export interface AdminRuntime {
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
  schema: Schema | null;
  relationGraph: RelationGraph | null;
  models: Model[];
  modelList: Array<{ name: string; label: string }>;
  config: AdminHandlerConfig;
  basePath: string;
  perPage: number;
  /** Tailles sélectionnables, vide quand le mécanisme est désactivé. */
  pageSizes: number[];
  /** Widgets validés au démarrage (jamais re-validés par requête). */
  dashboard: ResolvedDashboard;
  /** `models[].defaultSort` validé au démarrage, par nom de modèle. */
  defaultSortOf(model: Model): ActiveSort | undefined;
  selectThreshold: number;
  filterLinkThreshold: number;
  labelFieldCandidates: string[];
  findModel(name?: string): Model | undefined;
  labelOf(model: Model): string;
  hiddenFieldsOf(model: Model): Set<string>;
  viewModel(model: Model): ViewModel;
  resolveLabel(
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string;
  resolveFilterableFields(model: Model): Set<string>;
}

export function createAdminRuntime(config: AdminHandlerConfig): AdminRuntime {
  const {
    basePath = '/admin',
    exclude = [],
    hidePivotTables = true,
    models: modelsConfig = {}
  } = config;

  const adapter = config.adapter;
  const introspector: SchemaIntrospector = adapter.introspector;

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
    console.warn('[sveltekit-admin] Could not introspect schema:', e);
  }

  /**
   * Résolu une fois ici plutôt que dans `viewModel` : un `schema?.enums ?? …`
   * par appel serait une branche que rien ne peut exercer (un schéma nul donne
   * `models` vide, donc aucune vue à construire), alors qu'à ce niveau les deux
   * cas sont ceux du démarrage — schéma lu, ou introspection en échec.
   */
  const schemaEnums = schema?.enums ?? new Map<string, string[]>();

  const models = schema?.models.filter((m) => {
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
  const hiddenFieldsOf = (m: Model): Set<string> =>
    new Set(modelsConfig[m.name]?.hidden ?? []);

  for (const m of models) {
    const entries = modelsConfig[m.name]?.listFilter;
    // Non-null par construction : `models` n'existe que si le schéma
    // a été parsé, et le graphe est construit dans la même branche de boot.
    if (entries) validateListFilterConfig(m.name, entries, m, relationGraph!, hiddenFieldsOf(m));
  }

  /**
   * `defaultSort` validé ici pour la même raison que `listFilter` : une colonne
   * inexistante, ou que la liste n'affiche pas, produirait un tri mort à chaque
   * rendu sans qu'aucun en-tête ne l'annonce — et l'utilisateur n'aurait aucun
   * moyen d'en sortir, puisque seule une colonne affichée porte un lien. La
   * liste des colonnes autorisées est la même que celle du tri par URL.
   */
  const defaultSortOf = (m: Model): ActiveSort | undefined => {
    const configured = modelsConfig[m.name]?.defaultSort;
    if (!configured) return undefined;
    const sortable = resolveListColumns(m.fields, {
      hidden: modelsConfig[m.name]?.hidden,
      listFields: modelsConfig[m.name]?.listFields
    }).map((f) => f.name);
    if (!sortable.includes(configured.field)) {
      throw new AdminConfigError(
        `[sveltekit-admin] models.${m.name}.defaultSort targets "${configured.field}", ` +
          `which the list view does not display. Displayed columns: [${sortable.join(', ')}].`
      );
    }
    if (configured.dir !== undefined && configured.dir !== 'asc' && configured.dir !== 'desc') {
      throw new AdminConfigError(
        `[sveltekit-admin] models.${m.name}.defaultSort.dir must be "asc" or "desc".`
      );
    }
    return { field: configured.field, dir: configured.dir ?? 'asc' };
  };
  const defaultSorts = new Map(models.map((m) => [m.name, defaultSortOf(m)]));

  const labelOf = (m: Model) => {
    const configured = modelsConfig[m.name]?.label;
    if (configured) return configured;
    const label = toLabel(m.name);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const modelList = models.map((m) => ({ name: m.name, label: labelOf(m) }));
  const findModel = (name?: string) =>
    models.find((m) => m.name.toLowerCase() === name?.toLowerCase());
  const viewModel = (m: Model): ViewModel => ({
    name: m.name,
    label: labelOf(m),
    fields: m.fields,
    primaryKey: primaryKeyOf(m),
    enums: schemaEnums,
    // Non-null par construction : `m` vient toujours de `models`,
    // dérivé du schéma qu'on vient de parser avec succès.
    relationGraph: relationGraph!
  });

  /**
   * Plafond dur. Au-delà ce n'est plus une page mais un export, et sur une
   * table volumineuse une requête qui tient la connexion. Vaut pour la valeur
   * configurée comme pour chaque option proposée.
   */
  const MAX_PAGE_SIZE = 200;
  const validPageSize = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE_SIZE;

  if (config.perPage !== undefined && !validPageSize(config.perPage)) {
    throw new AdminConfigError(
      `[sveltekit-admin] perPage must be an integer between 1 and ${MAX_PAGE_SIZE}.`
    );
  }
  const perPage = config.perPage ?? 20;

  const configuredSizes = config.pageSizeOptions ?? [10, 20, 50, 100];
  if (!Array.isArray(configuredSizes) || !configuredSizes.every(validPageSize)) {
    throw new AdminConfigError(
      `[sveltekit-admin] pageSizeOptions must be integers between 1 and ${MAX_PAGE_SIZE}.`
    );
  }
  const pageSizes = resolvePageSizes(perPage, configuredSizes);

  const selectThreshold = config.relationDefaults?.selectThreshold ?? 200;
  const filterLinkThreshold = config.listFilterDefaults?.linkThreshold ?? 20;
  const labelFieldCandidates = config.relationDefaults?.labelFields ?? [
    'name', 'title', 'label', 'email', 'username', 'slug'
  ];

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
  const resolveFilterableFields = (model: Model): Set<string> => {
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

  // Même politique que `listFilter` et les plugins : une config de dashboard
  // invalide arrête le démarrage plutôt que de produire un bloc mort à chaque
  // rendu.
  const dashboard = resolveDashboard({
    config: config.dashboard,
    models,
    enums: schemaEnums,
    basePath,
    searchFieldsOf: (m) =>
      resolveSearchFields(m, modelsConfig[m.name]?.searchFields, labelFieldCandidates, hiddenFieldsOf(m)),
    filterableFieldsOf: resolveFilterableFields,
    sortableColumnsOf: (m) =>
      resolveListColumns(m.fields, {
        hidden: modelsConfig[m.name]?.hidden,
        listFields: modelsConfig[m.name]?.listFields
      }).map((f) => f.name),
    defaultSortOf: (m) => defaultSorts.get(m.name),
    labelOf
  });

  /**
   * Résout le label BRUT (non échappé) d'une ligne : premier champ String
   * candidat présent, sinon template `{a} {b}` si configuré, sinon la PK.
   * Déterministe. Svelte échappe automatiquement à l'interpolation dans les
   * composants — pas besoin d'échapper ici.
   */
  const resolveLabel = (
    targetModel: Model,
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

  return {
    adapter,
    schema,
    relationGraph,
    models,
    modelList,
    config,
    basePath,
    perPage,
    pageSizes,
    dashboard,
    defaultSortOf: (m: Model) => defaultSorts.get(m.name),
    selectThreshold,
    filterLinkThreshold,
    labelFieldCandidates,
    findModel,
    labelOf,
    hiddenFieldsOf,
    viewModel,
    resolveLabel,
    resolveFilterableFields
  };
}
