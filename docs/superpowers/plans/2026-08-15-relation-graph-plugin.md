# Relation Graph Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship first-party `relationGraphPlugin({ models?, depth? })` at `sveltekit-admin/plugins/relation-graph` — a record dependency graph page (`/:model/:id/graph`) implemented solely through the existing `AdminPlugin` contract.

**Architecture:** Factory returns an `AdminPlugin` (`name: 'relation-graph'`, pattern `[':model', ':id', 'graph']`, action label `Graph`). `walk.ts` BFS-walks `ctx.relationGraph` using `loadRecord` / `listRecords` / `getM2mSelectedIds` (never `record.posts` — `redactForAudit` strips relations). `layout.ts` assigns BFS-column x/y. `render.ts` emits SVG in `html` plus a static pan/zoom `scripts` string. The core does not learn `depth` / `models`.

**Tech Stack:** TypeScript, existing Svelte 5 SSR Layout, Vitest. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-relation-graph-plugin-design.md`

## Global Constraints

- **100% coverage, no exceptions**: `vitest.config.ts` enforces lines/statements/functions/branches at 100% on `src/lib/**`. No `exclude`, no `v8 ignore`. Do not add a `default: never` on `RelationKind` (uncoverable). Cover all four kinds with a returning `switch` (TS exhaustiveness without a branch).
- **Package manager is pnpm.** Single-file: `pnpm exec vitest run <path>`. Full suite: `pnpm run test`. Types: `pnpm run check`. Run `pnpm run test:gen` once in a fresh shell before tests if `tests/fixtures/prisma/client/` is missing.
- Quote style: **single quotes**, match `handler.ts`.
- Do **not** widen `AdminPlugin`. Do **not** export `relationGraphPlugin` from `.`. Do **not** export `createAdminRuntime`. Do **not** add JSON endpoints, Vite, D3, Svelte Flow, nav, CRUD intercept, or fan-out caps.
- Do **not** modify `tests/fixtures/fakeGraphPlugin.ts`. Do **not** use `ctx.event` in the first-party plugin. Do **not** scope builtin edit/delete.
- Factory `depth` default `2`, integer `0..8`, throw `[sveltekit-admin] relationGraphPlugin: depth must be an integer in 0..8`. `models` omit = all visible (omit the property; do not pass `[]` unless the caller did).
- Changeset **minor**.
- Do not commit unless the user explicitly asked — skip every Commit step if they have not.
- Worktree isolation: execute from a **new** worktree `feat/relation-graph-plugin` on `origin/main` (`b7e5630`). Do **not** reuse `.worktrees/admin-plugin-api`. Copy this plan + the spec into the worktree if they are not on the branch yet.

## File map

| File | Role |
| --- | --- |
| `src/lib/server/plugins/relation-graph/walk.ts` | BFS walk → `{ nodes, edges }`. |
| `src/lib/server/plugins/relation-graph/layout.ts` | Pure x/y + viewBox. |
| `src/lib/server/plugins/relation-graph/render.ts` | HTML/SVG/CSS + static pan/zoom script. |
| `src/lib/server/plugins/relation-graph/index.ts` | `relationGraphPlugin` factory. |
| `package.json` | `exports["./plugins/relation-graph"]`. |
| `tests/unit/plugins/relation-graph/walk.test.ts` | Walk, mocked ctx. |
| `tests/unit/plugins/relation-graph/layout.test.ts` | Columns, one node, determinism. |
| `tests/unit/plugins/relation-graph/render.test.ts` | HTML/SVG/escape/hint/opaque. |
| `tests/unit/plugins/relation-graph/plugin.test.ts` | Factory shape + depth throw. |
| `tests/unit/plugins/relation-graph/exports.test.ts` | Subpath vs `.`. |
| `tests/unit/plugins/relation-graph/handler.test.ts` | Real handler GET/POST/slots. |
| `docs/src/lib/content/docs/plugins.svx` | First-party import + options. |
| `README.md` | One paragraph under Plugins. |
| `.changeset/relation-graph-plugin.md` | Minor. |

---

### Task 1: Walk (`walk.ts`)

**Files:**
- Create: `src/lib/server/plugins/relation-graph/walk.ts`
- Test: `tests/unit/plugins/relation-graph/walk.test.ts`

**Interfaces:**
- Consumes: `PluginPageContext`, `RelationEdge` / `RelationGraph` / `RelationKind`, `Filter`, `Model`.
- Produces: `walk(ctx, opts) → Promise<WalkGraph>`, types `GraphNode`, `GraphEdge`, `WalkGraph`, `WalkOptions` (imported by layout / factory later).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/plugins/relation-graph/walk.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { RelationEdge, RelationGraph } from '../../../../src/lib/server/introspection/relations.js';
import type { PluginPageContext } from '../../../../src/lib/server/plugin.js';
import type { Field, Model } from '../../../../src/lib/server/types/schema.js';
import { walk } from '../../../../src/lib/server/plugins/relation-graph/walk.js';

function field(over: Partial<Field> & Pick<Field, 'name'>): Field {
  return {
    type: 'String',
    isRequired: false,
    isList: false,
    isUnique: false,
    isId: false,
    isUpdatedAt: false,
    isCreatedAt: false,
    hasDefault: false,
    ...over
  };
}

function model(name: string, fields: Field[]): Model {
  return { name, fields };
}

function edge(
  over: Partial<RelationEdge> & Pick<RelationEdge, 'model' | 'field' | 'kind' | 'target'>
): RelationEdge {
  return {
    relationName: '',
    isRequired: false,
    isList: over.kind === 'to-many-inverse' || over.kind === 'm2m',
    scalarFields: [],
    selfReferential: over.model === over.target,
    hasBackReference: true,
    ...over
  };
}

const User = model('User', [
  field({ name: 'id', type: 'Int', isId: true, isRequired: true }),
  field({ name: 'email', type: 'String' })
]);
const Post = model('Post', [
  field({ name: 'id', type: 'String', isId: true, isRequired: true }),
  field({ name: 'title', type: 'String' }),
  field({ name: 'authorId', type: 'Int' }),
  field({ name: 'reviewerId', type: 'Int' })
]);
const Tag = model('Tag', [
  field({ name: 'id', type: 'Int', isId: true, isRequired: true }),
  field({ name: 'name', type: 'String' })
]);
const Profile = model('Profile', [
  field({ name: 'id', type: 'Int', isId: true, isRequired: true }),
  field({ name: 'userId', type: 'Int' }),
  field({ name: 'bio', type: 'String' })
]);
const Category = model('Category', [
  field({ name: 'id', type: 'Int', isId: true, isRequired: true }),
  field({ name: 'name', type: 'String' }),
  field({ name: 'parentId', type: 'Int' })
]);

function graph(edges: RelationEdge[]): RelationGraph {
  const m = new Map<string, RelationEdge>();
  for (const e of edges) m.set(`${e.model}.${e.field}`, e);
  return {
    edges: m,
    scalarToRelation: new Map(),
    relationToScalars: new Map(),
    diagnostics: []
  };
}

function makeCtx(over: {
  models?: Model[];
  record: Record<string, unknown>;
  route?: { view?: string; model?: string; id?: string };
  relationGraph?: RelationGraph | null;
  loadRecord?: PluginPageContext['loadRecord'];
  listRecords?: PluginPageContext['listRecords'];
  getM2mSelectedIds?: PluginPageContext['getM2mSelectedIds'];
  resolveLabel?: PluginPageContext['resolveLabel'];
  modelsOpt?: never;
}): PluginPageContext {
  const models = over.models ?? [User, Post, Tag, Profile, Category];
  const resolveLabel =
    over.resolveLabel ??
    ((target: Model, row: Record<string, unknown>) =>
      String(row.email ?? row.title ?? row.name ?? row.id));
  return {
    event: new Proxy(
      {},
      {
        get() {
          throw new Error('ctx.event must not be used');
        }
      }
    ),
    route: {
      view: 'plugin/relation-graph/:model/:id/graph',
      model: 'user',
      id: '1',
      ...over.route
    },
    basePath: '/admin',
    record: over.record,
    escapeHtml: (s) => s,
    findModel: (name?: string) =>
      models.find((m) => m.name.toLowerCase() === String(name).toLowerCase()),
    relationGraph: over.relationGraph === undefined ? graph([]) : over.relationGraph,
    resolveLabel,
    hiddenFieldsOf: () => new Set(),
    isSensitiveFieldName: () => false,
    loadRecord: over.loadRecord ?? (async () => null),
    listRecords: over.listRecords ?? (async () => []),
    getM2mSelectedIds: over.getM2mSelectedIds ?? (async () => [])
  };
}

const authorOwning = edge({
  model: 'Post',
  field: 'author',
  kind: 'to-one-owning',
  target: 'User',
  relationName: 'AuthorPosts',
  scalarFields: ['authorId']
});
const postsInverse = edge({
  model: 'User',
  field: 'posts',
  kind: 'to-many-inverse',
  target: 'Post',
  relationName: 'AuthorPosts'
});
const reviewerOwning = edge({
  model: 'Post',
  field: 'reviewer',
  kind: 'to-one-owning',
  target: 'User',
  relationName: 'ReviewerPosts',
  scalarFields: ['reviewerId']
});
const reviewsInverse = edge({
  model: 'User',
  field: 'reviews',
  kind: 'to-many-inverse',
  target: 'Post',
  relationName: 'ReviewerPosts'
});
const tagsM2m = edge({
  model: 'Post',
  field: 'tags',
  kind: 'm2m',
  target: 'Tag',
  relationName: ''
});
const postsM2m = edge({
  model: 'Tag',
  field: 'posts',
  kind: 'm2m',
  target: 'Post',
  relationName: ''
});
const profileInverse = edge({
  model: 'User',
  field: 'profile',
  kind: 'to-one-inverse',
  target: 'Profile',
  relationName: ''
});
const profileOwning = edge({
  model: 'Profile',
  field: 'user',
  kind: 'to-one-owning',
  target: 'User',
  relationName: '',
  scalarFields: ['userId']
});
const parentOwning = edge({
  model: 'Category',
  field: 'parent',
  kind: 'to-one-owning',
  target: 'Category',
  relationName: 'CategoryTree',
  scalarFields: ['parentId'],
  selfReferential: true
});
const childrenInverse = edge({
  model: 'Category',
  field: 'children',
  kind: 'to-many-inverse',
  target: 'Category',
  relationName: 'CategoryTree',
  selfReferential: true
});

describe('walk', () => {
  it('to-one-owning: child → parent FK edge', async () => {
    const g = graph([authorOwning, postsInverse]);
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: 1 },
      route: { model: 'post', id: 'p1' },
      relationGraph: g,
      loadRecord: async (modelName, id) =>
        modelName === 'User' && String(id) === '1' ? { id: 1, email: 'a@b.c' } : null
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.nodes.map((n) => n.key).sort()).toEqual(['Post:p1', 'User:1']);
    expect(out.edges).toEqual([{ from: 'Post:p1', to: 'User:1', field: 'author', kind: 'fk' }]);
    const user = out.nodes.find((n) => n.key === 'User:1')!;
    expect(user.opaque).toBe(false);
    expect(user.href).toBe('/admin/user/1');
    expect(user.label).toBe('a@b.c');
  });

  it('inverse to-many: parent lists children, edge still child → parent labeled owning field', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([authorOwning, postsInverse]),
      listRecords: async (modelName, extra) => {
        expect(modelName).toBe('Post');
        expect(extra).toEqual({ op: 'eq', field: 'authorId', value: 1 });
        return [{ id: 'p1', title: 'Hello', authorId: 1 }];
      }
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([{ from: 'Post:p1', to: 'User:1', field: 'author', kind: 'fk' }]);
    expect(out.nodes.find((n) => n.key === 'Post:p1')?.label).toBe('Hello');
  });

  it('inverse to-one (User.profile)', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([profileInverse, profileOwning]),
      listRecords: async () => [{ id: 9, userId: 1, bio: 'x' }]
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([{ from: 'Profile:9', to: 'User:1', field: 'user', kind: 'fk' }]);
  });

  it('m2m: in-scope + opaque (no resolveLabel on miss)', async () => {
    const resolveLabel = vi.fn((target: Model, row: Record<string, unknown>) =>
      String(row.name ?? row.title ?? row.email ?? row.id)
    );
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: 1 },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([tagsM2m, postsM2m]),
      resolveLabel,
      getM2mSelectedIds: async () => [2, 9],
      loadRecord: async (modelName, id) =>
        modelName === 'Tag' && Number(id) === 2 ? { id: 2, name: 'js' } : null
    });
    const out = await walk(ctx, { depth: 1 });
    const opaque = out.nodes.find((n) => n.key === 'Tag:9')!;
    expect(opaque.opaque).toBe(true);
    expect(opaque.label).toBe('#9');
    expect(opaque.href).toBeNull();
    expect(opaque.graphHref).toBeNull();
    expect(resolveLabel.mock.calls.every((c) => c[0].name !== 'Tag' || c[1].id === 2)).toBe(true);
    expect(out.edges.filter((e) => e.kind === 'm2m')).toHaveLength(2);
  });

  it('m2m walked from both sides dedups to one undirected edge', async () => {
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello' },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([tagsM2m, postsM2m]),
      getM2mSelectedIds: async (modelName) => (modelName === 'Post' ? [2] : ['p1']),
      loadRecord: async (modelName, id) => {
        if (modelName === 'Tag') return { id: 2, name: 'js' };
        if (modelName === 'Post') return { id: 'p1', title: 'Hello' };
        return null;
      }
    });
    const out = await walk(ctx, { depth: 2 });
    expect(out.edges.filter((e) => e.kind === 'm2m')).toHaveLength(1);
  });

  it('cycle A↔B: two nodes, FK edge deduped', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([authorOwning, postsInverse]),
      listRecords: async () => [{ id: 'p1', title: 'Hello', authorId: 1 }],
      loadRecord: async () => ({ id: 1, email: 'a@b.c' })
    });
    const out = await walk(ctx, { depth: 2 });
    expect(out.nodes).toHaveLength(2);
    expect(out.edges.filter((e) => e.kind === 'fk')).toHaveLength(1);
  });

  it('depth 0: root only, no edges', async () => {
    const listRecords = vi.fn(async () => [{ id: 'p1' }]);
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([postsInverse, authorOwning]),
      listRecords
    });
    const out = await walk(ctx, { depth: 0 });
    expect(out.nodes).toEqual([
      expect.objectContaining({ key: 'User:1', depth: 0 })
    ]);
    expect(out.edges).toEqual([]);
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('depth 2 does not expand level-2 nodes', async () => {
    const listRecords = vi.fn(async (modelName: string) => {
      if (modelName === 'Post') return [{ id: 'p1', title: 'Hello', authorId: 1 }];
      throw new Error(`unexpected listRecords ${modelName}`);
    });
    const getM2m = vi.fn(async () => [2]);
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([postsInverse, authorOwning, tagsM2m, postsM2m]),
      listRecords,
      getM2mSelectedIds: getM2m,
      loadRecord: async (modelName, id) => {
        if (modelName === 'Tag') return { id: 2, name: 'js' };
        if (modelName === 'User') return { id: 1, email: 'a@b.c' };
        return null;
      }
    });
    const out = await walk(ctx, { depth: 2 });
    expect(out.nodes.map((n) => n.key).sort()).toEqual(['Post:p1', 'Tag:2', 'User:1']);
    expect(out.nodes.find((n) => n.key === 'Tag:2')?.depth).toBe(2);
    expect(getM2m.mock.calls.every((c) => c[0] === 'Post')).toBe(true);
  });

  it('hidden / absent FK scalar: no edge', async () => {
    const loadRecord = vi.fn(async () => ({ id: 1, email: 'a@b.c' }));
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello' },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([authorOwning]),
      loadRecord
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
    expect(loadRecord).not.toHaveBeenCalled();
  });

  it('null FK: no edge', async () => {
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: null },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([authorOwning]),
      loadRecord: async () => ({ id: 1, email: 'a@b.c' })
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
  });

  it('unsupported composite / ambiguous skipped', async () => {
    const composite = edge({
      ...authorOwning,
      unsupported: 'composite-fk',
      scalarFields: ['a', 'b']
    });
    const ambiguous = edge({
      ...tagsM2m,
      unsupported: 'ambiguous'
    });
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: 1, a: 1, b: 2 },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([composite, ambiguous]),
      loadRecord: async () => ({ id: 1, email: 'x' }),
      getM2mSelectedIds: async () => [1]
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
  });

  it('excluded target model: skip edge, no throw', async () => {
    const ctx = makeCtx({
      models: [User],
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([postsInverse, authorOwning]),
      listRecords: async () => {
        throw new Error('should not list excluded Post');
      }
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toEqual([]);
  });

  it('relationGraph null: root only', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: null
    });
    const out = await walk(ctx, { depth: 2 });
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toEqual([]);
  });

  it('author + reviewer: two FK edges to same User', async () => {
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: 1, reviewerId: 1 },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([authorOwning, reviewerOwning, postsInverse, reviewsInverse]),
      loadRecord: async () => ({ id: 1, email: 'a@b.c' })
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toEqual(
      expect.arrayContaining([
        { from: 'Post:p1', to: 'User:1', field: 'author', kind: 'fk' },
        { from: 'Post:p1', to: 'User:1', field: 'reviewer', kind: 'fk' }
      ])
    );
    expect(out.edges).toHaveLength(2);
  });

  it('self-ref manager: one node, reflexive FK edge', async () => {
    const ctx = makeCtx({
      record: { id: 1, name: 'Root', parentId: 1 },
      route: { model: 'category', id: '1' },
      relationGraph: graph([parentOwning, childrenInverse]),
      loadRecord: async () => ({ id: 1, name: 'Root', parentId: 1 })
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toContainEqual({
      from: 'Category:1',
      to: 'Category:1',
      field: 'parent',
      kind: 'fk'
    });
  });

  it('models whitelist: Post in-scope has edit href, no graphHref', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([postsInverse, authorOwning]),
      listRecords: async () => [{ id: 'p1', title: 'Hello', authorId: 1 }]
    });
    const out = await walk(ctx, { depth: 1, models: ['User'] });
    const post = out.nodes.find((n) => n.key === 'Post:p1')!;
    expect(post.href).toBe('/admin/post/p1');
    expect(post.graphHref).toBeNull();
    const user = out.nodes.find((n) => n.key === 'User:1')!;
    expect(user.graphHref).toBe('/admin/user/1/graph');
  });

  it('owning FK miss → opaque node, id from scalar, no extra loadRecord', async () => {
    const loadRecord = vi.fn(async () => null);
    const resolveLabel = vi.fn(() => 'LEAK');
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', authorId: 99 },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([authorOwning]),
      loadRecord,
      resolveLabel
    });
    const out = await walk(ctx, { depth: 1 });
    const opaque = out.nodes.find((n) => n.key === 'User:99')!;
    expect(opaque.opaque).toBe(true);
    expect(opaque.label).toBe('#99');
    expect(opaque.href).toBeNull();
    expect(resolveLabel).toHaveBeenCalledTimes(1);
    expect(resolveLabel.mock.calls[0][0].name).toBe('Post');
  });

  it('inverse with 0 or >1 owning counterparts is skipped', async () => {
    const noOwner = edge({
      model: 'User',
      field: 'ghosts',
      kind: 'to-many-inverse',
      target: 'Post',
      relationName: 'Missing'
    });
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([noOwner]),
      listRecords: async () => {
        throw new Error('should not list');
      }
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
  });

  it('does not read ctx.event', async () => {
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: null
    });
    await expect(walk(ctx, { depth: 0 })).resolves.toMatchObject({
      nodes: [expect.objectContaining({ key: 'User:1' })]
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/walk.test.ts`

Expected: FAIL — cannot resolve `walk.js`.

- [ ] **Step 3: Implement `walk.ts`**

Create `src/lib/server/plugins/relation-graph/walk.ts`:

```ts
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
  ): Promise<GraphNode | null> => {
    const target = ctx.findModel(modelName);
    if (!target) return null;
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
        if (neighbor) addFk(currentKey, neighbor.key, edge.field);
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
          if (neighbor) addFk(neighbor.key, currentKey, owning.field);
        }
        continue;
      }
      const ids = await ctx.getM2mSelectedIds(current.model.name, edge.field, current.id);
      for (const mid of ids) {
        const row = await ctx.loadRecord(edge.target, mid);
        const neighbor = await ensure(edge.target, mid, row, current.depth + 1);
        if (neighbor) addM2m(currentKey, neighbor.key, edge.relationName, edge.field);
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...fkEdges.values(), ...m2mEdges.values()]
  };
}
```

Do not import or read `ctx.event`. Do not call `adapter`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/walk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/plugins/relation-graph/walk.ts tests/unit/plugins/relation-graph/walk.test.ts
git commit -m "$(cat <<'EOF'
feat: walk relation graphs via plugin helpers

EOF
)"
```

---

### Task 2: Layout (`layout.ts`)

**Files:**
- Create: `src/lib/server/plugins/relation-graph/layout.ts`
- Test: `tests/unit/plugins/relation-graph/layout.test.ts`

**Interfaces:**
- Consumes: `WalkGraph`, `GraphNode`, `GraphEdge` from `walk.ts`.
- Produces: `layout(graph) → LaidOutGraph`, constants `COL_W`, `ROW_H`, `NODE_R`, `PAD`, type `LaidOutNode` / `LaidOutGraph`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/plugins/relation-graph/layout.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/layout.test.ts`

Expected: FAIL — cannot resolve `layout.js`.

- [ ] **Step 3: Implement `layout.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/layout.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** (skip unless asked)

```bash
git add src/lib/server/plugins/relation-graph/layout.ts tests/unit/plugins/relation-graph/layout.test.ts
git commit -m "$(cat <<'EOF'
feat: lay out relation-graph nodes by BFS depth

EOF
)"
```

---

### Task 3: Render (`render.ts`)

**Files:**
- Create: `src/lib/server/plugins/relation-graph/render.ts`
- Test: `tests/unit/plugins/relation-graph/render.test.ts`

**Interfaces:**
- Consumes: `LaidOutGraph` from `layout.ts`, `PluginPageContext` (only `escapeHtml` + `findModel` / `route` for the title model name).
- Produces: `renderGraphPage(ctx, laidOut) → PluginPageResult`, exported `PAN_ZOOM_SCRIPT` constant (no DB interpolation).

Title: `{Model.name} · {root.label}` where root is `laidOut.nodes.find(n => n.depth === 0)!`. Model name from `root.model` (already schema case). Hint iff `laidOut.edges.length === 0`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/plugins/relation-graph/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../../../src/lib/server/views/html.js';
import { NODE_R, PAD, layout } from '../../../../src/lib/server/plugins/relation-graph/layout.js';
import {
  PAN_ZOOM_SCRIPT,
  renderGraphPage
} from '../../../../src/lib/server/plugins/relation-graph/render.js';
import type { PluginPageContext } from '../../../../src/lib/server/plugin.js';
import type { GraphNode } from '../../../../src/lib/server/plugins/relation-graph/walk.js';

function node(over: Partial<GraphNode> & Pick<GraphNode, 'key'>): GraphNode {
  const [model, id] = over.key.split(':');
  return {
    model,
    id,
    label: String(id),
    opaque: false,
    href: `/admin/${model.toLowerCase()}/${id}`,
    graphHref: null,
    depth: 0,
    ...over
  };
}

function ctx(): Pick<PluginPageContext, 'escapeHtml'> {
  return { escapeHtml };
}

describe('renderGraphPage', () => {
  it('renders title, hint when there are no edges, and one node', () => {
    const laid = layout({
      nodes: [node({ key: 'User:1', label: 'Ada <x>', depth: 0 })],
      edges: []
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('class="ska-rg"');
    expect(page.html).toContain('<h1 class="ska-rg__title">');
    expect(page.html).toContain('User · Ada &lt;x&gt;');
    expect(page.html).toContain('No related records in scope.');
    expect(page.html).toContain('class="ska-rg-viewport"');
    expect(page.html).toContain('class="ska-rg-canvas"');
    expect(page.html).toContain(`r="${NODE_R}"`);
    expect(page.scripts).toBe(PAN_ZOOM_SCRIPT);
    expect(page.scripts).not.toMatch(/fetch\(/);
    expect(page.styles).toContain('.ska-rg');
  });

  it('escapes labels, fields, and hrefs; in-scope node is an edit link', () => {
    const laid = layout({
      nodes: [
        node({ key: 'User:1', label: 'Ada', depth: 0, href: '/admin/user/1', graphHref: '/admin/user/1/graph' }),
        node({
          key: 'Post:p1',
          label: 'Hi "there"',
          depth: 1,
          href: '/admin/post/p1" onclick="alert(1)',
          graphHref: null
        })
      ],
      edges: [{ from: 'Post:p1', to: 'User:1', field: 'author<script>', kind: 'fk' }]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('author&lt;script&gt;');
    expect(page.html).toContain('Hi &quot;there&quot;');
    expect(page.html).toContain('href="/admin/post/p1&quot; onclick=&quot;alert(1)"');
    expect(page.html).not.toContain('onclick="alert(1)"');
    expect(page.html).toContain('marker-end');
    expect(page.html).toContain('class="ska-rg-node__graph"');
    expect(page.html).not.toContain('ska-rg__hint');
  });

  it('opaque node has no edit <a> and uses the opaque class', () => {
    const laid = layout({
      nodes: [
        node({ key: 'User:1', label: 'Ada', depth: 0 }),
        node({
          key: 'User:99',
          label: '#99',
          depth: 1,
          opaque: true,
          href: null,
          graphHref: null
        })
      ],
      edges: [{ from: 'User:99', to: 'User:1', field: 'author', kind: 'fk' }]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('ska-rg-node--opaque');
    expect(page.html).toMatch(/ska-rg-node--opaque[\s\S]*#99/);
    expect(page.html).not.toMatch(/<a[^>]*href="\/admin\/user\/99"/);
  });

  it('m2m edges have no arrow marker; reflexive FK is a path loop', () => {
    const laid = layout({
      nodes: [node({ key: 'Category:1', label: 'Root', depth: 0 })],
      edges: [
        { from: 'Category:1', to: 'Category:1', field: 'parent', kind: 'fk' },
        { from: 'Category:1', to: 'Category:1', field: 'friends', kind: 'm2m' }
      ]
    });
    const page = renderGraphPage(ctx() as PluginPageContext, laid);
    expect(page.html).toContain('<path');
    expect(page.html).toContain('ska-rg-edge--m2m');
    expect(page.html).toContain(`cx="${PAD}"`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/render.test.ts`

Expected: FAIL — cannot resolve `render.js`.

- [ ] **Step 3: Implement `render.ts`**

```ts
import type { PluginPageContext } from '../../plugin.js';
import { NODE_R } from './layout.js';
import type { LaidOutGraph, LaidOutNode } from './layout.js';
import type { GraphEdge } from './walk.js';

export const PAN_ZOOM_SCRIPT =
  '(function(){var vp=document.querySelector(".ska-rg-viewport");var g=document.querySelector(".ska-rg-canvas");if(!vp||!g)return;var s=1,x=0,y=0,px=0,py=0,drag=false;function apply(){g.setAttribute("transform","translate("+x+" "+y+") scale("+s+")");}vp.addEventListener("pointerdown",function(e){drag=true;px=e.clientX;py=e.clientY;vp.setPointerCapture(e.pointerId);});vp.addEventListener("pointerup",function(){drag=false;});vp.addEventListener("pointermove",function(e){if(!drag)return;x+=e.clientX-px;y+=e.clientY-py;px=e.clientX;py=e.clientY;apply();});vp.addEventListener("wheel",function(e){e.preventDefault();var n=e.deltaY<0?s*1.1:s/1.1;if(n<0.4)n=0.4;if(n>3)n=3;s=n;apply();},{passive:false});})();';

const STYLES = `.ska-rg{padding:1rem 1.5rem 2rem;flex:1}
.ska-rg__title{font-size:1.25rem;margin-bottom:0.5rem}
.ska-rg__hint{color:#64748b;margin-bottom:0.75rem}
.ska-rg-viewport{overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;min-height:320px;cursor:grab}
.ska-rg-node__label{font-size:12px;fill:#1e293b;max-width:160px}
.ska-rg-node--root circle{fill:var(--ska-primary);stroke:var(--ska-primary)}
.ska-rg-node--root .ska-rg-node__label{fill:#fff}
.ska-rg-node circle{fill:#fff;stroke:var(--ska-primary);stroke-width:2}
.ska-rg-node--opaque circle{stroke:#94a3b8;stroke-dasharray:4 3;fill:#f8fafc}
.ska-rg-node--opaque .ska-rg-node__label{fill:#94a3b8}
.ska-rg-edge{stroke:var(--ska-primary);stroke-width:1.5;fill:none}
.ska-rg-edge--m2m{stroke-dasharray:6 4;stroke:#64748b}
.ska-rg-edge__label{font-size:10px;fill:#64748b}
.ska-rg-node__graph{font-size:10px;fill:var(--ska-primary)}`;

function loopPath(n: LaidOutNode): string {
  const { x, y } = n;
  const r = NODE_R;
  return `M ${x} ${y - r} C ${x + 40} ${y - 52}, ${x + 40} ${y + 52}, ${x} ${y + r}`;
}

function edgeSvg(
  edge: GraphEdge,
  byKey: Map<string, LaidOutNode>,
  esc: (s: string) => string
): string {
  const from = byKey.get(edge.from);
  const to = byKey.get(edge.to);
  if (!from || !to) return '';
  const label = esc(edge.field);
  const isM2m = edge.kind === 'm2m';
  const cls = isM2m ? 'ska-rg-edge ska-rg-edge--m2m' : 'ska-rg-edge';
  const marker = isM2m ? '' : ' marker-end="url(#ska-rg-arrow)"';
  if (from.key === to.key) {
    const d = loopPath(from);
    return `<path class="${cls}" d="${d}"${marker}></path><text class="ska-rg-edge__label" x="${from.x + 44}" y="${from.y}">${label}</text>`;
  }
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  return `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"${marker}></line><text class="ska-rg-edge__label" x="${mx}" y="${my}">${label}</text>`;
}

function nodeSvg(n: LaidOutNode, esc: (s: string) => string): string {
  const rootCls = n.depth === 0 ? ' ska-rg-node--root' : '';
  const opaqueCls = n.opaque ? ' ska-rg-node--opaque' : '';
  const title = `<title>${esc(n.label)}</title>`;
  const circle = `<circle cx="${n.x}" cy="${n.y}" r="${NODE_R}"></circle>`;
  const text = `<text class="ska-rg-node__label" x="${n.x}" y="${n.y + NODE_R + 14}" text-anchor="middle">${esc(n.label)}</text>`;
  const graphLink = n.graphHref
    ? `<a class="ska-rg-node__graph" href="${esc(n.graphHref)}"><text class="ska-rg-node__graph" x="${n.x}" y="${n.y + NODE_R + 28}" text-anchor="middle">Graph</text></a>`
    : '';
  const inner = `${title}${circle}${text}${graphLink}`;
  if (n.opaque || !n.href) {
    return `<g class="ska-rg-node${rootCls}${opaqueCls}">${inner}</g>`;
  }
  return `<a class="ska-rg-node${rootCls}" href="${esc(n.href)}">${inner}</a>`;
}

export function renderGraphPage(ctx: PluginPageContext, laidOut: LaidOutGraph) {
  const esc = ctx.escapeHtml;
  const root = laidOut.nodes.find((n) => n.depth === 0)!;
  const byKey = new Map(laidOut.nodes.map((n) => [n.key, n]));
  const hint =
    laidOut.edges.length === 0
      ? '<p class="ska-rg__hint">No related records in scope.</p>'
      : '';
  const edges = laidOut.edges.map((e) => edgeSvg(e, byKey, esc)).join('');
  const nodes = laidOut.nodes.map((n) => nodeSvg(n, esc)).join('');
  const html = `<div class="ska-rg"><h1 class="ska-rg__title">${esc(root.model)} · ${esc(root.label)}</h1>${hint}<div class="ska-rg-viewport"><svg width="${laidOut.width}" height="${laidOut.height}" viewBox="${esc(laidOut.viewBox)}"><defs><marker id="ska-rg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ska-primary)"></path></marker></defs><g class="ska-rg-canvas">${edges}${nodes}</g></svg></div></div>`;
  return { html, styles: STYLES, scripts: PAN_ZOOM_SCRIPT };
}
```

Assume every edge endpoint exists in `laidOut.nodes` (the walk never emits dangling edges). Use `byKey.get(edge.from)!` / `byKey.get(edge.to)!` — no `if (!from)` guard (uncoverable).

If the first test's XSS label `Ada <x>` is only in the title, `escapeHtml` must be used there (it is).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/render.test.ts`

Expected: PASS. If a selector/class assertion is slightly off, fix the test to match the implementation rather than adding dead classes.

- [ ] **Step 5: Commit** (skip unless asked)

```bash
git add src/lib/server/plugins/relation-graph/render.ts tests/unit/plugins/relation-graph/render.test.ts
git commit -m "$(cat <<'EOF'
feat: SSR SVG for the relation-graph page

EOF
)"
```

---

### Task 4: Factory + package export

**Files:**
- Create: `src/lib/server/plugins/relation-graph/index.ts`
- Modify: `package.json` (`exports`)
- Test: `tests/unit/plugins/relation-graph/plugin.test.ts`
- Test: `tests/unit/plugins/relation-graph/exports.test.ts`

**Interfaces:**
- Consumes: `walk`, `layout`, `renderGraphPage`, `AdminPlugin`.
- Produces: `relationGraphPlugin(opts?) → AdminPlugin`, type `RelationGraphPluginOptions`. Subpath `sveltekit-admin/plugins/relation-graph`. `.` unchanged (still five runtime exports).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/plugins/relation-graph/plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';

describe('relationGraphPlugin', () => {
  it('returns name, graph pattern, Graph action, omitted models', () => {
    const plugin = relationGraphPlugin();
    expect(plugin.name).toBe('relation-graph');
    expect(plugin.pages).toHaveLength(1);
    expect(plugin.pages![0].pattern).toEqual([':model', ':id', 'graph']);
    expect(plugin.pages![0].models).toBeUndefined();
    expect(plugin.recordActions).toHaveLength(1);
    expect(plugin.recordActions![0].label).toBe('Graph');
    expect(plugin.recordActions![0].models).toBeUndefined();
    expect(plugin.recordActions![0].href({ model: 'User', id: 1, basePath: '/admin' })).toBe(
      '/admin/user/1/graph'
    );
  });

  it('forwards models onto page and action', () => {
    const plugin = relationGraphPlugin({ models: ['User'] });
    expect(plugin.pages![0].models).toEqual(['User']);
    expect(plugin.recordActions![0].models).toEqual(['User']);
  });

  it('forwards empty models array', () => {
    const plugin = relationGraphPlugin({ models: [] });
    expect(plugin.pages![0].models).toEqual([]);
  });

  it('throws on non-integer / out-of-range depth', () => {
    const msg = /relationGraphPlugin: depth must be an integer in 0\.\.8/;
    expect(() => relationGraphPlugin({ depth: -1 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: 9 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: 2.5 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: NaN })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: Infinity })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: '2' as any })).toThrow(msg);
  });

  it('accepts depth 0 and 8', () => {
    expect(relationGraphPlugin({ depth: 0 }).name).toBe('relation-graph');
    expect(relationGraphPlugin({ depth: 8 }).name).toBe('relation-graph');
  });
});
```

Create `tests/unit/plugins/relation-graph/exports.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as root from '../../../../src/lib/index.js';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';

describe('sveltekit-admin/plugins/relation-graph', () => {
  it('exports relationGraphPlugin as a function', () => {
    expect(typeof relationGraphPlugin).toBe('function');
  });

  it('does not add a runtime export on the root entry', () => {
    expect(Object.keys(root)).not.toContain('relationGraphPlugin');
  });

  it('package.json exposes ./plugins/relation-graph', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./plugins/relation-graph']).toMatchObject({
      types: './dist/server/plugins/relation-graph/index.d.ts',
      svelte: './dist/server/plugins/relation-graph/index.js',
      default: './dist/server/plugins/relation-graph/index.js'
    });
  });

  it('root index.ts does not import the plugin', () => {
    const src = readFileSync(new URL('../../../../src/lib/index.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('relationGraphPlugin');
    expect(src).not.toContain('plugins/relation-graph');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/plugin.test.ts tests/unit/plugins/relation-graph/exports.test.ts`

Expected: FAIL — missing `index.js` / missing `exports` key.

- [ ] **Step 3: Implement factory + `package.json`**

Create `src/lib/server/plugins/relation-graph/index.ts`:

```ts
import type { AdminPlugin, AdminPluginPage, AdminPluginRecordAction } from '../../plugin.js';
import { layout } from './layout.js';
import { renderGraphPage } from './render.js';
import { walk } from './walk.js';

export interface RelationGraphPluginOptions {
  models?: string[];
  depth?: number;
}

export function relationGraphPlugin(opts: RelationGraphPluginOptions = {}): AdminPlugin {
  const depth = opts.depth === undefined ? 2 : opts.depth;
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) {
    throw new Error('[sveltekit-admin] relationGraphPlugin: depth must be an integer in 0..8');
  }

  const page: AdminPluginPage = {
    pattern: [':model', ':id', 'graph'],
    render: async (ctx) => {
      const g = await walk(ctx, { depth, models: opts.models });
      return renderGraphPage(ctx, layout(g));
    }
  };
  if (opts.models) page.models = opts.models;

  const action: AdminPluginRecordAction = {
    label: 'Graph',
    href: ({ model, id, basePath }) => `${basePath}/${model.toLowerCase()}/${id}/graph`
  };
  if (opts.models) action.models = opts.models;

  return { name: 'relation-graph', pages: [page], recordActions: [action] };
}
```

In `package.json`, add next to `./adapters/drizzle`:

```json
"./plugins/relation-graph": {
  "types": "./dist/server/plugins/relation-graph/index.d.ts",
  "svelte": "./dist/server/plugins/relation-graph/index.js",
  "default": "./dist/server/plugins/relation-graph/index.js"
}
```

Do **not** touch `src/lib/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/plugin.test.ts tests/unit/plugins/relation-graph/exports.test.ts tests/unit/index.test.ts`

Expected: PASS (`index.test.ts` still has exactly five runtime exports).

- [ ] **Step 5: Commit** (skip unless asked)

```bash
git add src/lib/server/plugins/relation-graph/index.ts package.json tests/unit/plugins/relation-graph/plugin.test.ts tests/unit/plugins/relation-graph/exports.test.ts
git commit -m "$(cat <<'EOF'
feat: export relationGraphPlugin at sveltekit-admin/plugins/relation-graph

EOF
)"
```

---

### Task 5: Handler wiring tests

**Files:**
- Test: `tests/unit/plugins/relation-graph/handler.test.ts`

**Interfaces:**
- Consumes: `relationGraphPlugin`, core + Prisma `createAdminHandler`, `createPrismaMock`, `FULL_SCHEMA_PATH`, `createEvent`.
- Produces: characterization that the real plugin is served through the existing plugin pipeline (no core changes expected).

Use `FULL_SCHEMA_PATH` (User.posts / Post.author / Post.categories). Seed `{ user: [USER], post: [POST] }` like `handler.plugins.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/plugins/relation-graph/handler.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler as createCoreHandler } from '../../../../src/lib/server/handler.js';
import { createAdminHandler as createPrismaHandler } from '../../../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';
import { createEvent } from '../../../fixtures/events.js';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';

afterEach(() => vi.restoreAllMocks());

const USER = { id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', name: 'Ada' };
const POST = { id: 'p1', title: 'Hello', authorId: 1, content: 'x' };

function core(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({ user: [USER], post: [POST] }),
  pluginOpts?: { models?: string[]; depth?: number }
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return {
    handler: createCoreHandler({
      adapter,
      plugins: [relationGraphPlugin(pluginOpts)],
      ...config
    } as any),
    prisma
  };
}

async function html(handler: any, url: string, extra?: Parameters<typeof createEvent>[0]) {
  const { event, resolve } = createEvent({ url, ...extra });
  const res = await handler({ event, resolve } as any);
  return { res, text: await res.text() };
}

describe('relationGraphPlugin via createAdminHandler', () => {
  it('GET /admin/user/1/graph renders Layout + SVG, not JSON', async () => {
    const { handler } = core();
    const { res, text } = await html(handler, '/admin/user/1/graph');
    expect(res.status).toBe(200);
    expect(text).toContain('ska-layout');
    expect(text).toContain('ska-rg');
    expect(text).toContain('User · Ada');
    expect(text).toContain('<svg');
    expect(text).toContain('ska-rg-viewport');
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    expect(text.trim().startsWith('{')).toBe(false);
  });

  it('does not inject graph CSS/JS on list/edit/dashboard', async () => {
    const { handler } = core();
    for (const url of ['/admin', '/admin/user', '/admin/user/1']) {
      const { text } = await html(handler, url);
      expect(text).not.toContain('ska-rg-viewport');
      expect(text).not.toContain('.ska-rg{');
    }
  });

  it('list + edit User show Graph before Edit', async () => {
    const { handler } = core({}, undefined, { models: ['User'] });
    const list = await html(handler, '/admin/user');
    expect(list.text).toContain('href="/admin/user/1/graph"');
    expect(list.text.indexOf('href="/admin/user/1/graph"')).toBeLessThan(list.text.indexOf('>Edit</a>'));
    const edit = await html(handler, '/admin/user/1');
    expect(edit.text).toContain('ska-record-actions');
    expect(edit.text).toContain('href="/admin/user/1/graph"');
    expect(edit.text.indexOf('href="/admin/user/1/graph"')).toBeLessThan(
      edit.text.indexOf('<form method="POST"')
    );
  });

  it('create User has no Graph action', async () => {
    const { handler } = core({}, undefined, { models: ['User'] });
    const { text } = await html(handler, '/admin/user/new');
    expect(text).not.toContain('ska-record-actions');
    expect(text).not.toContain('/graph');
  });

  it('POST /admin/user/1/graph is 405', async () => {
    const { handler, prisma } = core();
    const { event, resolve } = createEvent({
      url: '/admin/user/1/graph',
      body: { _action: 'delete', id: '1' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(prisma.calls.filter((c) => c.method === 'delete')).toHaveLength(0);
  });

  it('listWhere miss → NotFound without ska-rg', async () => {
    const { handler } = core({
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toMatch(/User with ID "1" not found/);
    expect(text).not.toContain('ska-rg');
  });

  it('createAdminHandler({ prisma, plugins }) serves the page', async () => {
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const handler = createPrismaHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      plugins: [relationGraphPlugin({ models: ['User'] })]
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-rg');
  });

  it('createAdminHandler({ adapter, plugins }) serves the page', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-rg');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm exec vitest run tests/unit/plugins/relation-graph/handler.test.ts`

Expected: PASS if Task 4 wired `render`. If User label is `a@b.c` instead of `Ada` (`name` optional on the mock row vs schema), assert whichever `resolveLabel` actually returns (`name` is a String field before `email` in candidates — with `name: 'Ada'` the title is `User · Ada`).

If GET graph fails because `full.prisma` User has no `tenantId` and something else throws, fix the test data, not the core.

- [ ] **Step 3: Confirm fake plugin tests still pass**

Run: `pnpm exec vitest run tests/unit/handler.plugins.test.ts tests/fixtures/fakeGraphPlugin.ts`

(`fakeGraphPlugin.ts` is not a test file — run `tests/unit/handler.plugins.test.ts` only.)

Expected: PASS, fixture file unmodified (`git diff -- tests/fixtures/fakeGraphPlugin.ts` empty).

- [ ] **Step 4: Commit** (skip unless asked)

```bash
git add tests/unit/plugins/relation-graph/handler.test.ts
git commit -m "$(cat <<'EOF'
test: serve relationGraphPlugin through createAdminHandler

EOF
)"
```

---

### Task 6: Docs + changeset + verification

**Files:**
- Modify: `docs/src/lib/content/docs/plugins.svx`
- Modify: `README.md` (Plugins section)
- Create: `.changeset/relation-graph-plugin.md`

Do **not** add a core key to `configuration-reference.svx`. Do **not** wire `example/`.

- [ ] **Step 1: Docs**

In `docs/src/lib/content/docs/plugins.svx`, after the sentence about factory options (`relationGraphPlugin({ models, depth }) belong on the plugin author`), add a section:

```md
## First-party: `relationGraphPlugin`

A dependency graph for one record, shipped at
`sveltekit-admin/plugins/relation-graph` (same subpath idea as
`sveltekit-admin/adapters/drizzle`). Third-party plugins are their own
npm packages that `import type { AdminPlugin } from 'sveltekit-admin'` —
they cannot add keys under `sveltekit-admin/plugins/`.

```typescript
import { createAdminHandler } from 'sveltekit-admin';
import { relationGraphPlugin } from 'sveltekit-admin/plugins/relation-graph';

export const handle = createAdminHandler({
  prisma,
  plugins: [relationGraphPlugin({ models: ['User'], depth: 2 })]
});
```

- `models?: string[]` — which models get the **Graph** link and the
  `/admin/<model>/<id>/graph` page. Omit = every visible model. The walk
  still visits other visible models as neighbours (a User graph can show
  Posts).
- `depth?: number` — BFS hops, default `2`, integer `0..8` (`0` = root
  only). Invalid values throw when the factory runs (handler boot).

The page is GET-only SVG inside the existing layout. There is no JSON
endpoint. Relations are **not** on `ctx.record` (`redactForAudit`
whitelists scalars); the plugin walks `ctx.relationGraph` and the scoped
helpers. A neighbour outside `listWhere` is an opaque `#id` node with no
label and no edit link. Inverse relations are already filtered by
`listRecords`. Fan-out is not capped. Node labels use
`resolveLabel(model, row)` without `models[].label` /
`relations[].labelTemplate` (the plugin context does not expose those).
```

Keep the existing generic `AdminPlugin` example above this section.

In `README.md`, replace the Plugins section body so the example shows the first-party import **in addition to** the generic `plugins: []` note:

```markdown
## Plugins

Pass `plugins` to register extra admin pages (SSR HTML + inline CSS/JS)
and links on edit screens and list rows. See the exported `AdminPlugin`
type and the documentation site's Plugins page.

A first-party relation graph is available as a subpath (not on the root
export):

```typescript
import { createAdminHandler } from 'sveltekit-admin';
import { relationGraphPlugin } from 'sveltekit-admin/plugins/relation-graph';

createAdminHandler({
  prisma,
  plugins: [relationGraphPlugin({ models: ['User'] })]
});
```

Omit `plugins` and the admin is unchanged.
```

- [ ] **Step 2: Changeset**

Create `.changeset/relation-graph-plugin.md` (skill `writing-changesets`: **minor**, new export; backticks on identifiers; state that omitting `plugins` is unchanged):

```md
---
"sveltekit-admin": minor
---

Add **`relationGraphPlugin`**, a first-party record dependency-graph page exported at `sveltekit-admin/plugins/relation-graph`. Pass it through the existing `plugins` array (`relationGraphPlugin({ models, depth })`); `createAdminHandler({ prisma })` without `plugins` is unchanged. The core `AdminPlugin` contract is not extended.
```

- [ ] **Step 3: Full verification**

Run:

```bash
pnpm run test
pnpm run check
```

Expected: all tests pass, including 100% coverage on `src/lib/**` (new files included). `svelte-check` clean.

If coverage misses a branch in `walk.ts` / `render.ts`, add a focused test — do not `v8 ignore`.

- [ ] **Step 4: Commit** (skip unless asked)

```bash
git add docs/src/lib/content/docs/plugins.svx README.md .changeset/relation-graph-plugin.md
git commit -m "$(cat <<'EOF'
docs: document relationGraphPlugin subpath export

EOF
)"
```

---

## Self-review (spec coverage)

| Spec item | Task |
| --- | --- |
| Subpath packaging, not `.` | 4 |
| Factory `models` / `depth` 0..8 throw | 4 |
| Walk owning / inverse / m2m / opaque / cycles / depth / hidden / unsupported / exclude / null graph / author+reviewer / self-ref / graphHref whitelist | 1 |
| Layout BFS columns | 2 |
| SVG SSR, hint, opaque no link, escape, pan/zoom constant, reflexive loop | 3 |
| Handler GET SVG, slots empty elsewhere, Graph action, 405, listWhere 404, prisma+adapter | 5 |
| Docs + minor changeset | 6 |
| `fakeGraphPlugin` untouched | 5 step 3 |
| No AdminPlugin widening, no JSON, no `ctx.event` | 1 + 4 |
| 100% coverage | 6 step 3 |
