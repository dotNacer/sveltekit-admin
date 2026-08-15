import { isSensitiveFieldName } from './introspection/parser.js';
import type { Schema, Model } from './types/schema.js';
import { buildRelationGraph, type RelationGraph } from './introspection/relations.js';
import { primaryKeyOf } from './data.js';
import { validateListFilterConfig } from './query/filterDetection.js';
import { normalizeScope } from './adapters/filter.js';
import { toLabel } from './views/html.js';
import type { ViewModel } from './views/types.js';
import type { DataAdapter, SchemaIntrospector } from './adapters/types.js';
import type { AdminHandlerConfig } from './handler.js';

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
    throw new Error(
      `[sveltekit-admin] models.${model.name}.listWhere returned an empty object ({}), ` +
        `which would silently disable list scoping (fail-open). Return undefined/omit the ` +
        `scope entirely if there is genuinely nothing to scope by for this request, or a ` +
        `condition that actually restricts rows otherwise.`
    );
  }
  return listScope;
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
    // Non-null par construction : `m` vient toujours de `models`,
    // dérivé du schéma qu'on vient de parser avec succès.
    relationGraph: relationGraph!
  });

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
    perPage: 20,
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
