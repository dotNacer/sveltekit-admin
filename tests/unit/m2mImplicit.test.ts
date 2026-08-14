import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const post = { id: 'ckp1', title: 'T', authorId: 1, reviewerId: null };
const tags = [
  { id: 1, name: 'js' },
  { id: 2, name: 'ts' },
  { id: 3, name: 'svelte' }
];
const users = [{ id: 1, email: 'alice@a.c' }];

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH, ...config } as any);
}

function formEvent(url: string, fields: [string, string][]) {
  const body = new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  const url2 = new URL(url, 'http://localhost');
  const request = new Request(url2, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  const resolve = Object.assign(async () => new Response('resolved'), { called: false });
  return { event: { url: url2, request, locals: {} }, resolve };
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users, post: [{ ...post, tags: [tags[0]] }], tag: tags, profile: [], follow: [],
    order: [], line: [], auditLog: [], category: [], comment: [], label: [], ...overrides
  };
}

describe('PR3 — N-N implicite', () => {
  it('le formulaire edit rend un fieldset de checkboxes pour la relation N-N', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="__rel__tags"');
    expect(html).toContain('value="1" class="ska-checkbox" checked');
    expect(html).toContain('value="2" class="ska-checkbox"/>');
    expect(html).toContain('__rel_present__tags');
  });

  it('le formulaire create rend le fieldset sans aucune coche', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = createEvent({ url: '/admin/post/new' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="__rel__tags"');
    expect(html).not.toContain('checked');
  });

  it('au-delà du seuil : input texte IDs séparés par virgule', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { relationDefaults: { selectThreshold: 1 } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    const tagsArea = html.split('name="__rel__tags"')[1].split('>')[0];
    expect(tagsArea).not.toContain('type="checkbox"');
    expect(html).toContain('value="1"');
  });

  it('POST create : coche 2 tags → connect', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = formEvent('/admin/post/new', [
      ['_action', 'create'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '1'], ['__rel__tags', '2']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const create = callsTo(prisma, 'post', 'create')[0];
    expect((create.args as any).data.tags).toEqual({ connect: [{ id: 1 }, { id: 2 }] });
  });

  it('POST update : coche 1 tag → set', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '2']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'post', 'update')[0];
    expect((update.args as any).data.tags).toEqual({ set: [{ id: 2 }] });
  });

  it('POST : tout décoché + sentinelle présent → vide la relation (set: [])', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'post', 'update')[0];
    expect((update.args as any).data.tags).toEqual({ set: [] });
  });

  it('POST : sentinelle absente (champ hidden/exclu) → no-op, pas de clé tags', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'post', 'update')[0];
    expect((update.args as any).data.tags).toBeUndefined();
  });

  it('POST : ID de tag inexistant → erreur, pas d\'écriture', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '999']
    ]);
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('POST : ID non numérique sur PK Int → erreur', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', 'abc']
    ]);
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('invalid id');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('where de scoping : limite les options du checkbox group', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { tags: { where: () => ({ name: 'js' }) } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('js');
  });

  it('where de scoping N-N : ID hors scope rejeté (IDOR)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { tags: { where: () => ({ name: 'js' }) } } } }
    });
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '2']
    ]);
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it.each([
    'nested Prisma `where` is not supported by the Drizzle adapter',
    "[sveltekit-admin] unknown field 'name' on Drizzle table"
  ])('POST N-N échoue fermé si l’adapter refuse de compiler le scope : %s', async (message) => {
    const prisma = createPrismaMock(baseData());
    prisma.tag.findMany = () => {
      throw new Error(message);
    };
    const { event, resolve } = formEvent('/admin/post/ckp1', [
      ['_action', 'update'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '2']
    ]);

    const html = await (await handler(prisma)({ event, resolve } as any)).text();

    expect(html).toContain('tags: invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('self-referential N-N implicite (friends/friendOf User) : rendu et écriture', async () => {
    const alice = { id: 1, email: 'alice@a.c', friends: [] };
    const bob = { id: 2, email: 'bob@b.c', friends: [] };
    const prisma = createPrismaMock({ ...baseData(), user: [alice, bob] });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="__rel__friends"');

    const { event: e2, resolve: r2 } = formEvent('/admin/user/1', [
      ['_action', 'update'], ['email', 'alice@a.c'],
      ['__rel_present__friends', '1'], ['__rel__friends', '2']
    ]);
    await handler(prisma)({ event: e2, resolve: r2 } as any);
    const update = callsTo(prisma, 'user', 'update')[0];
    expect((update.args as any).data.friends).toEqual({ set: [{ id: 2 }] });
  });

  it('cible de relation N-N absente du client : repli raw-id', async () => {
    const prisma = createPrismaMock(baseData({ tag: undefined as any }));
    delete (prisma as any).tag;
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="__rel__tags"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('loadSelectedIds : échec de la requête findUnique → liste vide, pas de crash', async () => {
    const prisma = createPrismaMock(baseData({
      post: [{ ...post, tags: [tags[0]] }]
    }), {
      post: {
        // Ne casse que l'appel avec `include` (loadSelectedIds) ; `getRecord`
        // (sans include) doit continuer à fonctionner pour rendre le form.
        findUnique: (args: any) => {
          if (args?.include) throw new Error('boom');
          return Promise.resolve({ ...post, tags: [tags[0]] });
        }
      }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="__rel__tags"');
    expect(html).not.toContain('checked');
  });

  it('POST : IDs N-N soumis en checkboxes distinctes (pas de virgule)', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = formEvent('/admin/post/new', [
      ['_action', 'create'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '1'], ['__rel__tags', '2'], ['__rel__tags', '3']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const create = callsTo(prisma, 'post', 'create')[0];
    expect((create.args as any).data.tags).toEqual({
      connect: [{ id: 1 }, { id: 2 }, { id: 3 }]
    });
  });

  it('POST : IDs N-N soumis en une seule valeur CSV (raw-id au-delà du seuil)', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const h = handler(prisma, { relationDefaults: { selectThreshold: 1 } });
    const { event, resolve } = formEvent('/admin/post/new', [
      ['_action', 'create'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__tags', '1'], ['__rel__tags', '1, 2']
    ]);
    await h({ event, resolve } as any);
    const create = callsTo(prisma, 'post', 'create')[0];
    expect((create.args as any).data.tags).toEqual({
      connect: [{ id: 1 }, { id: 2 }]
    });
  });

  it('POST : N-N implicite avec PK cible String (non-Int)', async () => {
    const prisma = createPrismaMock(baseData({
      post: [], label: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }]
    }));
    const { event, resolve } = formEvent('/admin/post/new', [
      ['_action', 'create'], ['title', 'T'], ['authorId', '1'],
      ['__rel_present__labels', '1'], ['__rel__labels', 'a'], ['__rel__labels', 'b']
    ]);
    await handler(prisma)({ event, resolve } as any);
    const create = callsTo(prisma, 'post', 'create')[0];
    expect((create.args as any).data.labels).toEqual({
      connect: [{ slug: 'a' }, { slug: 'b' }]
    });
  });
});
