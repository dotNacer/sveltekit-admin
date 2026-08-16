import { describe, it, expect } from 'vitest';
import {
  COL_W,
  NODE_R,
  PAD,
  ROW_H,
  layout
} from '../../../../src/lib/server/plugins/relation-graph/layout.js';
import type { WalkGraph } from '../../../../src/lib/server/plugins/relation-graph/walk.js';

function node(
  key: string,
  depth: number,
  over: Record<string, unknown> = {}
): WalkGraph['nodes'][number] {
  const [model, id] = key.split(':');
  return {
    key,
    model,
    id,
    label: key,
    opaque: false,
    href: '/x',
    graphHref: null,
    depth,
    ...over
  };
}

describe('layout', () => {
  it('places one node at PAD,PAD and sizes the viewBox', () => {
    const g = layout({ nodes: [node('User:1', 0)], edges: [] });
    expect(g.nodes[0]).toMatchObject({ x: PAD, y: PAD });
    expect(g.width).toBe(PAD + PAD + NODE_R);
    expect(g.height).toBe(PAD + PAD + NODE_R);
    expect(g.viewBox).toBe(`0 0 ${g.width} ${g.height}`);
  });

  it('uses BFS depth as columns and insertion order within a column', () => {
    const g = layout({
      nodes: [node('User:1', 0), node('Post:p1', 1), node('Tag:2', 1)],
      edges: []
    });
    const byKey = Object.fromEntries(g.nodes.map((n) => [n.key, n]));
    expect(byKey['User:1']).toMatchObject({ x: PAD, y: PAD });
    expect(byKey['Post:p1']).toMatchObject({ x: PAD + COL_W, y: PAD });
    expect(byKey['Tag:2']).toMatchObject({ x: PAD + COL_W, y: PAD + ROW_H });
  });

  it('is deterministic', () => {
    const input: WalkGraph = {
      nodes: [node('User:1', 0), node('Post:a', 1), node('Post:b', 1)],
      edges: [{ from: 'Post:a', to: 'User:1', field: 'author', kind: 'fk' }]
    };
    expect(layout(input)).toEqual(layout(input));
  });

  it('keeps a single node for a reflexive edge', () => {
    const g = layout({
      nodes: [node('Category:1', 0)],
      edges: [{ from: 'Category:1', to: 'Category:1', field: 'parent', kind: 'fk' }]
    });
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(1);
  });
});
