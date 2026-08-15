import { normalizeScope } from './adapters/filter.js';
import type { Filter } from './adapters/types.js';
import { redactForAudit } from './audit.js';
import { coerceId, primaryKeyOf } from './data.js';
import { isSensitiveFieldName } from './introspection/parser.js';
import type { PluginPageContext } from './plugin.js';
import { listScopeFrom, type AdminRuntime } from './runtime.js';
import type { Model } from './types/schema.js';
import { escapeHtml } from './views/html.js';

function andFilters(...parts: Array<Filter | Record<string, unknown> | undefined>): Filter | undefined {
  const clauses = parts.filter((p): p is Filter | Record<string, unknown> => p !== undefined);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0] as Filter;
  return { op: 'and', clauses: clauses as Filter[] };
}

function redactRow(runtime: AdminRuntime, model: Model, row: Record<string, unknown>): Record<string, unknown> {
  return redactForAudit(row, model, runtime.hiddenFieldsOf(model));
}

export function createPluginPageContext(
  runtime: AdminRuntime,
  event: any,
  route: { view: string; model?: string; id?: string },
  record?: Record<string, unknown>
): PluginPageContext {
  const loadRecord = async (
    modelName: string,
    id: string | number
  ): Promise<Record<string, unknown> | null> => {
    const model = runtime.findModel(modelName);
    if (!model) return null;
    const rawScope = listScopeFrom(runtime, model, { locals: event.locals });
    const scope = normalizeScope(rawScope);
    const idFilter = {
      op: 'eq' as const,
      field: primaryKeyOf(model),
      value: coerceId(String(id), model)
    };
    const filter = (scope ? { op: 'and' as const, clauses: [idFilter, scope] } : idFilter) as Filter;
    const row = await runtime.adapter.data.findFirst(model, filter);
    return row ? redactRow(runtime, model, row) : null;
  };

  const listRecords = async (
    modelName: string,
    extraFilter?: Filter
  ): Promise<Record<string, unknown>[]> => {
    const model = runtime.findModel(modelName);
    if (!model) return [];
    const rawScope = listScopeFrom(runtime, model, { locals: event.locals });
    const scope = normalizeScope(rawScope);
    const filter = andFilters(scope, extraFilter);
    const rows = await runtime.adapter.data.findMany(model, { filter: filter as Filter | undefined });
    return rows.map((row) => redactRow(runtime, model, row));
  };

  const getM2mSelectedIds = async (
    modelName: string,
    fieldName: string,
    recordId: string | number
  ): Promise<Array<string | number>> => {
    const model = runtime.findModel(modelName);
    if (!model) {
      throw new Error(`[sveltekit-admin] getM2mSelectedIds: unknown model "${modelName}"`);
    }
    // Non-null par construction : `model` vient toujours de `runtime.models`,
    // dérivé du schéma qu'on a parsé avec succès (même convention que
    // `runtime.ts` `validateListFilterConfig` / `viewModel`).
    const edge = runtime.relationGraph!.edges.get(`${model.name}.${fieldName}`);
    if (!edge || edge.kind !== 'm2m') {
      throw new Error(
        `[sveltekit-admin] getM2mSelectedIds: "${model.name}.${fieldName}" is not an m2m relation`
      );
    }
    const target = runtime.findModel(edge.target);
    if (!target) {
      throw new Error(
        `[sveltekit-admin] getM2mSelectedIds: target model "${edge.target}" is not visible`
      );
    }
    return runtime.adapter.data.getM2mSelectedIds(model, edge, target, recordId);
  };

  return {
    event,
    route,
    basePath: runtime.basePath,
    record,
    escapeHtml,
    findModel: runtime.findModel,
    relationGraph: runtime.relationGraph,
    resolveLabel: runtime.resolveLabel,
    hiddenFieldsOf: runtime.hiddenFieldsOf,
    isSensitiveFieldName,
    loadRecord,
    listRecords,
    getM2mSelectedIds
  };
}
