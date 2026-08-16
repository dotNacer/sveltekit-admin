import type { GraphEdge, GraphNode, WalkGraph } from './walk.js';

export const COL_W = 240;
export const ROW_H = 88;
export const NODE_R = 20;
export const PAD = 48;

export type LaidOutNode = GraphNode & { x: number; y: number };

export type LaidOutGraph = {
  nodes: LaidOutNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  viewBox: string;
};

export function layout(graph: WalkGraph): LaidOutGraph {
  const columns = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const col = columns.get(n.depth) ?? [];
    col.push(n);
    columns.set(n.depth, col);
  }
  const positioned: LaidOutNode[] = [];
  for (const n of graph.nodes) {
    const col = columns.get(n.depth)!;
    const index = col.indexOf(n);
    positioned.push({
      ...n,
      x: PAD + n.depth * COL_W,
      y: PAD + index * ROW_H
    });
  }
  let maxX = PAD;
  let maxY = PAD;
  for (const n of positioned) {
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const width = maxX + PAD + NODE_R;
  const height = maxY + PAD + NODE_R;
  return {
    nodes: positioned,
    edges: graph.edges,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`
  };
}
