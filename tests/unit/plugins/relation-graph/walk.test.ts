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
      loadRecord: async (modelName, _id) => {
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
    const getM2m = vi.fn<PluginPageContext['getM2mSelectedIds']>(async () => [2]);
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([postsInverse, authorOwning, tagsM2m, postsM2m]),
      listRecords,
      getM2mSelectedIds: getM2m,
      loadRecord: async (modelName, _id) => {
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
    const resolveLabel = vi.fn<PluginPageContext['resolveLabel']>(() => 'LEAK');
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

  it('pkOf falls back to id when model has no isId field', async () => {
    const NoPkUser = model('User', [field({ name: 'email', type: 'String' })]);
    const ctx = makeCtx({
      models: [NoPkUser],
      record: { id: 1, email: 'a@b.c' },
      relationGraph: null
    });
    const out = await walk(ctx, { depth: 0 });
    expect(out.nodes).toEqual([expect.objectContaining({ key: 'User:1' })]);
  });

  it('root id falls back to route.id when pk field absent from record', async () => {
    const ctx = makeCtx({
      record: { email: 'a@b.c' },
      route: { model: 'user', id: '1' },
      relationGraph: null
    });
    const out = await walk(ctx, { depth: 0 });
    expect(out.nodes).toEqual([expect.objectContaining({ key: 'User:1', id: '1' })]);
  });

  it('owning edge with scalarFields.length !== 1 is skipped without loadRecord', async () => {
    const composite = edge({
      model: 'Post',
      field: 'author',
      kind: 'to-one-owning',
      target: 'User',
      relationName: 'AuthorPosts',
      scalarFields: ['a', 'b']
    });
    const loadRecord = vi.fn(async () => ({ id: 1, email: 'a@b.c' }));
    const ctx = makeCtx({
      record: { id: 'p1', title: 'Hello', a: 1, b: 2 },
      route: { model: 'post', id: 'p1' },
      relationGraph: graph([composite]),
      loadRecord
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
    expect(loadRecord).not.toHaveBeenCalled();
  });

  it('unnamed relations: User posts + profile both resolve at depth 1', async () => {
    const postsUnnamedInverse = edge({
      model: 'User',
      field: 'posts',
      kind: 'to-many-inverse',
      target: 'Post',
      relationName: ''
    });
    const authorUnnamedOwning = edge({
      model: 'Post',
      field: 'author',
      kind: 'to-one-owning',
      target: 'User',
      relationName: '',
      scalarFields: ['authorId']
    });
    const listRecords = vi.fn(async (modelName: string) => {
      if (modelName === 'Post') return [{ id: 'p1', title: 'Hello', authorId: 1 }];
      if (modelName === 'Profile') return [{ id: 9, userId: 1, bio: 'x' }];
      throw new Error(`unexpected listRecords ${modelName}`);
    });
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([
        postsUnnamedInverse,
        authorUnnamedOwning,
        profileInverse,
        profileOwning
      ]),
      listRecords
    });
    const out = await walk(ctx, { depth: 1 });
    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(listRecords).toHaveBeenCalledWith('Post', {
      op: 'eq',
      field: 'authorId',
      value: 1
    });
    expect(listRecords).toHaveBeenCalledWith('Profile', {
      op: 'eq',
      field: 'userId',
      value: 1
    });
    expect(out.nodes.map((n) => n.key).sort()).toEqual(['Post:p1', 'Profile:9', 'User:1']);
    expect(out.edges).toEqual(
      expect.arrayContaining([
        { from: 'Post:p1', to: 'User:1', field: 'author', kind: 'fk' },
        { from: 'Profile:9', to: 'User:1', field: 'user', kind: 'fk' }
      ])
    );
    expect(out.edges).toHaveLength(2);
  });

  it('inverse with two owning counterparts is skipped', async () => {
    const dualOwningA = edge({
      model: 'Post',
      field: 'author',
      kind: 'to-one-owning',
      target: 'User',
      relationName: 'Ambiguous',
      scalarFields: ['authorId']
    });
    const dualOwningB = edge({
      model: 'Post',
      field: 'reviewer',
      kind: 'to-one-owning',
      target: 'User',
      relationName: 'Ambiguous',
      scalarFields: ['reviewerId']
    });
    const ambiguousInverse = edge({
      model: 'User',
      field: 'posts',
      kind: 'to-many-inverse',
      target: 'Post',
      relationName: 'Ambiguous'
    });
    const listRecords = vi.fn(async () => [{ id: 'p1', title: 'Hello', authorId: 1 }]);
    const ctx = makeCtx({
      record: { id: 1, email: 'a@b.c' },
      relationGraph: graph([dualOwningA, dualOwningB, ambiguousInverse]),
      listRecords
    });
    const out = await walk(ctx, { depth: 1 });
    expect(out.edges).toEqual([]);
    expect(listRecords).not.toHaveBeenCalled();
  });
});
