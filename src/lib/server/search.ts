/**
 * `_search` JSON endpoint — split out of `handler.ts`, pure orchestration
 * over `AdminRuntime`.
 */

import { primaryKeyOf, paginate } from './data.js';
import { scopeFrom, modelScopeFrom, type AdminRuntime } from './runtime.js';

/**
 * Endpoint de recherche `GET {basePath}/_search?rel=Model.field&q=...&page=N`.
 * Sert les options d'une relation to-one-owning ou m2m en JSON
 * paginé — la voie prévue pour un futur widget autocomplete côté client
 * quand le nombre d'options dépasse `selectThreshold`. Respecte le `where`
 * de scoping configuré sur la relation, comme le select et la validation
 * POST : même garantie anti-IDOR sur les trois chemins.
 */
export async function handleSearch(runtime: AdminRuntime, event: any): Promise<Response> {
  const modelsConfig = runtime.config.models ?? {};
  const relParam = event.url.searchParams.get('rel') ?? '';
  const [modelName, fieldName] = relParam.split('.');
  const q = event.url.searchParams.get('q') ?? '';
  const { page } = paginate(event.url.searchParams.get('page'), runtime.perPage);

  const model = runtime.findModel(modelName);
  const edge = model && runtime.relationGraph
    ? runtime.relationGraph.edges.get(`${model.name}.${fieldName}`)
    : undefined;

  if (!model || !edge || (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m') || edge.unsupported) {
    return new Response(JSON.stringify({ error: 'unknown relation' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
  const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
  const configWhere = scopeFrom(relConfig, { locals: event.locals });
  const modelWhere = modelScopeFrom(runtime, targetModel, { locals: event.locals });

  // Recherche sur le premier champ String candidat du modèle cible — le
  // même champ que celui utilisé pour construire le label par défaut.
  const searchField = runtime.labelFieldCandidates.find((c) =>
    targetModel.fields.some((f) => f.name === c && f.type === 'String')
  );
  // `_search` must stay case-sensitive on every adapter/provider. A
  // `{ op: 'contains' }` leaf would pick up the adapter-wide
  // `caseInsensitiveSearch` flag (Prisma `mode: 'insensitive'`, Drizzle
  // `ilike`). `containsExact` compiles to `{ contains }` / `LIKE` with
  // no case-folding — same observable Prisma behavior as the previous
  // opaque `{ [field]: { contains: q } }` pass-through.
  const containsFilter =
    q && searchField
      ? { op: 'containsExact' as const, field: searchField, value: q }
      : undefined;
  const searchClauses = [modelWhere, configWhere, containsFilter].filter(Boolean);
  const searchFilter: any =
    searchClauses.length > 1
      ? { op: 'and', clauses: searchClauses }
      : searchClauses[0];

  try {
    // Count + fetch are independent reads — run them in parallel (as this
    // endpoint always has, pre-refactor) rather than doubling latency with
    // two sequential awaits.
    const [total, rows] = await Promise.all([
      runtime.adapter.data.countRecords(targetModel, searchFilter),
      runtime.adapter.data.findMany(targetModel, {
        filter: searchFilter,
        orderBy: relConfig?.orderBy,
        skip: (page - 1) * runtime.perPage,
        take: runtime.perPage
      })
    ]);
    const options = rows.map((row) => ({
      id: row[primaryKeyOf(targetModel)],
      label: runtime.resolveLabel(targetModel, row, relConfig?.labelTemplate)
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
}
