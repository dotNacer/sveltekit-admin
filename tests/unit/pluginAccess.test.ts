import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPluginPageContext } from '../../src/lib/server/pluginAccess.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

afterEach(() => vi.restoreAllMocks());

function ctxFor(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({
    user: [{ id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', tenantId: 1 }],
    post: [{ id: 'p1', title: 'Hello', authorId: 1 }]
  })
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  const runtime = createAdminRuntime({ adapter, ...config } as any);
  const event = { locals: { tenantId: 1 } };
  const ctx = createPluginPageContext(runtime, event, { view: 'plugin/x/:model/:id/graph', model: 'user', id: '1' });
  return { ctx, runtime, prisma };
}

describe('createPluginPageContext — loadRecord', () => {
  it('retourne null si le modèle est invisible', async () => {
    const { ctx } = ctxFor({ exclude: ['Post'] });
    expect(await ctx.loadRecord('Post', 'p1')).toBeNull();
  });

  it('applique listWhere AND pk via findFirst, pas getRecord', async () => {
    const { ctx, prisma } = ctxFor({
      models: { User: { listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId }) } }
    });
    const row = await ctx.loadRecord('User', 1);
    expect(row?.email).toBe('a@b.c');
    expect(prisma.calls.some((c) => c.model === 'user' && c.method === 'findUnique')).toBe(false);
    expect(prisma.calls.some((c) => c.model === 'user' && c.method === 'findFirst')).toBe(true);
  });

  it('retourne null hors listWhere', async () => {
    const { ctx } = ctxFor({
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    });
    expect(await ctx.loadRecord('User', 1)).toBeNull();
  });

  it('throw si listWhere renvoie {}', async () => {
    const { ctx } = ctxFor({ models: { User: { listWhere: () => ({}) } } });
    await expect(ctx.loadRecord('User', 1)).rejects.toThrow(/listWhere returned an empty object/);
  });

  it('redacte hidden + isSensitiveFieldName', async () => {
    const { ctx } = ctxFor({ models: { User: { hidden: ['bio'] } } });
    const row = await ctx.loadRecord('User', 1);
    expect(row).toMatchObject({ id: 1, email: 'a@b.c' });
    expect(row).not.toHaveProperty('password');
    expect(row).not.toHaveProperty('bio');
  });
});

describe('createPluginPageContext — listRecords', () => {
  it('retourne [] si le modèle est invisible', async () => {
    const { ctx } = ctxFor({ exclude: ['Post'] });
    expect(await ctx.listRecords('Post')).toEqual([]);
  });

  it('retourne les rows redacted sans listWhere ni extraFilter', async () => {
    const { ctx, prisma } = ctxFor();

    const rows = await ctx.listRecords('Post');

    expect(rows).toEqual([{ id: 'p1', title: 'Hello', authorId: 1 }]);
    expect(prisma.calls.find((c) => c.model === 'post' && c.method === 'findMany')?.args).toEqual({
      where: undefined
    });
  });

  it('applique un seul filtre sans AND', async () => {
    const prisma = createPrismaMock({
      post: [
        { id: 'p1', title: 'Hello', authorId: 1 },
        { id: 'p2', title: 'Hidden', authorId: 2 }
      ]
    });
    const { ctx } = ctxFor(
      {
        models: {
          Post: {
            listWhere: () => ({ authorId: 1 })
          }
        }
      },
      prisma
    );

    const rows = await ctx.listRecords('Post');

    expect(rows).toEqual([{ id: 'p1', title: 'Hello', authorId: 1 }]);
    expect(prisma.calls.find((c) => c.model === 'post' && c.method === 'findMany')?.args).toEqual({
      where: { authorId: 1 }
    });
  });

  it('AND extraFilter + listWhere et redacte chaque row', async () => {
    const prisma = createPrismaMock({
      user: [
        { id: 1, email: 'a@b.c', password: 's3cret', bio: 'x', tenantId: 1, role: 'ADMIN' },
        { id: 2, email: 'b@b.c', password: 's3cret', bio: 'y', tenantId: 1, role: 'USER' },
        { id: 3, email: 'c@b.c', password: 's3cret', bio: 'z', tenantId: 2, role: 'ADMIN' }
      ]
    });
    const { ctx } = ctxFor(
      {
        models: {
          User: {
            hidden: ['bio'],
            listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId })
          }
        }
      },
      prisma
    );
    const rows = await ctx.listRecords('User', { op: 'eq', field: 'role', value: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('a@b.c');
    expect(rows[0]).not.toHaveProperty('password');
    expect(rows[0]).not.toHaveProperty('bio');
  });
});

describe('createPluginPageContext — getM2mSelectedIds', () => {
  it('throw si le modèle est inconnu', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.getM2mSelectedIds('Nope', 'categories', 1)).rejects.toThrow(/unknown model "Nope"/);
  });

  it('throw si le champ n’est pas m2m', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.getM2mSelectedIds('User', 'posts', 1)).rejects.toThrow(/is not an m2m relation/);
  });

  it('throw si la cible m2m n’est pas visible', async () => {
    const { ctx } = ctxFor({ exclude: ['Category'] });
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).rejects.toThrow(
      /target model "Category" is not visible/
    );
  });

  it('délègue à adapter.data.getM2mSelectedIds', async () => {
    const { ctx, runtime } = ctxFor();
    const spy = vi.spyOn(runtime.adapter.data, 'getM2mSelectedIds').mockResolvedValue(['c1']);
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).resolves.toEqual(['c1']);
    expect(spy).toHaveBeenCalled();
  });

  it('retourne une liste vide si l’enregistrement parent est absent', async () => {
    const { ctx, runtime } = ctxFor();
    const spy = vi.spyOn(runtime.adapter.data, 'getM2mSelectedIds');
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'missing')).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('normalise en liste vide une réponse undefined de l’adapter', async () => {
    const { ctx, runtime } = ctxFor();
    vi.spyOn(runtime.adapter.data, 'getM2mSelectedIds').mockResolvedValue(undefined as any);
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).resolves.toEqual([]);
  });

  it('applique le scope configuré sur la relation m2m', async () => {
    const { ctx, runtime } = ctxFor({
      models: {
        Post: { relations: { categories: { where: () => ({ id: 'c1' }) } } }
      }
    });
    vi.spyOn(runtime.adapter.data, 'getM2mSelectedIds').mockResolvedValue(['c1', 'c2']);
    vi.spyOn(runtime.adapter.data, 'findMany').mockResolvedValue([{ id: 'c1' }]);
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).resolves.toEqual(['c1']);
  });
});

describe('createPluginPageContext — surface', () => {
  it('expose escapeHtml, isSensitiveFieldName (prédicat partagé) et pas d’adapter', () => {
    const { ctx } = ctxFor();
    expect(ctx.escapeHtml('<x>')).toBe('&lt;x&gt;');
    expect(ctx.isSensitiveFieldName('passwordHash')).toBe(true);
    expect(ctx.findModel('user')?.name).toBe('User');
    expect(ctx.relationGraph).not.toBeNull();
    expect(ctx).not.toHaveProperty('adapter');
    expect(Object.keys(ctx)).not.toContain('config');
  });
});
