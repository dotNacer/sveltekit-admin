import type { Filter } from '../../adapters/types.js';
import type { RelationEdge, RelationGraph, RelationKind } from '../../introspection/relations.js';
import type { PluginPageContext } from '../../plugin.js';
import type { Model } from '../../types/schema.js';

export type GraphNode = {
  key: string;
  model: string;
  id: string | number;
  label: string;
  opaque: boolean;
  href: string | null;
  graphHref: string | null;
  depth: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  field: string;
  kind: 'fk' | 'm2m';
};

export type WalkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type WalkOptions = {
  depth: number;
  models?: string[];
};

type Frame = {
  model: Model;
  id: string | number;
  record: Record<string, unknown>;
  depth: number;
};

function nodeKey(model: string, id: string | number): string {
  return `${model}:${String(id)}`;
}

function pkOf(model: Model): string {
  return model.fields.find((f) => f.isId)?.name || 'id';
}

function modelAllowedForGraph(models: string[] | undefined, modelName: string): boolean {
  if (!models) return true;
  return models.some((n) => n.toLowerCase() === modelName.toLowerCase());
}

function classifyKind(kind: RelationKind): 'owning' | 'inverse' | 'm2m' {
  switch (kind) {
    case 'to-one-owning':
      return 'owning';
    case 'to-one-inverse':
    case 'to-many-inverse':
      return 'inverse';
    case 'm2m':
      return 'm2m';
  }
}

function outgoing(graph: RelationGraph, modelName: string): RelationEdge[] {
  const out: RelationEdge[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.model === modelName) out.push(edge);
  }
  return out;
}

function findOwningCounterpart(
  graph: RelationGraph,
  inverse: RelationEdge,
  currentModel: string
): RelationEdge | null {
  const matches: RelationEdge[] = [];
  for (const edge of graph.edges.values()) {
    if (
      edge.kind === 'to-one-owning' &&
      edge.model === inverse.target &&
      edge.target === currentModel &&
      edge.relationName === inverse.relationName &&
      !edge.unsupported &&
      edge.scalarFields.length === 1
    ) {
      matches.push(edge);
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

function makeNode(
  ctx: PluginPageContext,
  opts: WalkOptions,
  model: Model,
  id: string | number,
  row: Record<string, unknown> | null,
  depth: number,
  opaque: boolean
): GraphNode {
  const slug = model.name.toLowerCase();
  return {
    key: nodeKey(model.name, id),
    model: model.name,
    id,
    label: opaque ? `#${id}` : ctx.resolveLabel(model, row!),
    opaque,
    href: opaque ? null : `${ctx.basePath}/${slug}/${id}`,
    graphHref:
      !opaque && modelAllowedForGraph(opts.models, model.name)
        ? `${ctx.basePath}/${slug}/${id}/graph`
        : null,
    depth
  };
}

export async function walk(ctx: PluginPageContext, opts: WalkOptions): Promise<WalkGraph> {
  const rootModel = ctx.findModel(ctx.route.model)!;
  const record = ctx.record!;
  const id = (record[pkOf(rootModel)] as string | number | undefined) ?? ctx.route.id!;
  const root = makeNode(ctx, opts, rootModel, id, record, 0, false);
  const nodes = new Map<string, GraphNode>([[root.key, root]]);
  const fkEdges = new Map<string, GraphEdge>();
  const m2mEdges = new Map<string, GraphEdge>();

  if (!ctx.relationGraph) {
    return { nodes: [...nodes.values()], edges: [] };
  }

  const queue: Frame[] = [{ model: rootModel, id, record, depth: 0 }];

  const addFk = (from: string, to: string, field: string) => {
    const k = `${from}\0${to}\0${field}\0fk`;
    if (!fkEdges.has(k)) fkEdges.set(k, { from, to, field, kind: 'fk' });
  };
  const addM2m = (a: string, b: string, relationName: string, field: string) => {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    const k = `${relationName}\0${min}\0${max}\0m2m`;
    if (!m2mEdges.has(k)) m2mEdges.set(k, { from: a, to: b, field, kind: 'm2m' });
  };

  const ensure = async (
    modelName: string,
    nid: string | number,
    row: Record<string, unknown> | null,
    depth: number
  ): Promise<GraphNode> => {
    const target = ctx.findModel(modelName)!;
    const key = nodeKey(target.name, nid);
    const existing = nodes.get(key);
    if (existing) return existing;
    const opaque = row === null;
    const node = makeNode(ctx, opts, target, nid, row, depth, opaque);
    nodes.set(key, node);
    if (!opaque) {
      queue.push({ model: target, id: nid, record: row!, depth });
    }
    return node;
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= opts.depth) continue;
    const currentKey = nodeKey(current.model.name, current.id);
    for (const edge of outgoing(ctx.relationGraph, current.model.name)) {
      if (edge.unsupported) continue;
      if (!ctx.findModel(edge.target)) continue;
      const bucket = classifyKind(edge.kind);
      if (bucket === 'owning') {
        if (edge.scalarFields.length !== 1) continue;
        const sf = edge.scalarFields[0]!;
        if (!(sf in current.record) || current.record[sf] == null) continue;
        const fk = current.record[sf] as string | number;
        const row = await ctx.loadRecord(edge.target, fk);
        const neighbor = await ensure(edge.target, fk, row, current.depth + 1);
        addFk(currentKey, neighbor.key, edge.field);
        continue;
      }
      if (bucket === 'inverse') {
        const owning = findOwningCounterpart(ctx.relationGraph, edge, current.model.name);
        if (!owning) continue;
        const children = await ctx.listRecords(edge.target, {
          op: 'eq',
          field: owning.scalarFields[0]!,
          value: current.id
        } as Filter);
        for (const child of children) {
          const childModel = ctx.findModel(edge.target)!;
          const cid = child[pkOf(childModel)] as string | number;
          const neighbor = await ensure(edge.target, cid, child, current.depth + 1);
          addFk(neighbor.key, currentKey, owning.field);
        }
        continue;
      }
      const ids = await ctx.getM2mSelectedIds(current.model.name, edge.field, current.id);
      for (const mid of ids) {
        const row = await ctx.loadRecord(edge.target, mid);
        const neighbor = await ensure(edge.target, mid, row, current.depth + 1);
        addM2m(currentKey, neighbor.key, edge.relationName, edge.field);
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...fkEdges.values(), ...m2mEdges.values()]
  };
}
