import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, callsTo, RELATIONS_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const users = [
  { id: 1, email: 'alice@a.c', name: 'Alice', bio: null },
  { id: 2, email: 'bob@b.c', name: 'Bob', bio: null },
  { id: 3, email: 'carol@c.c', name: 'Carol', bio: null }
];
const tags = [
  { id: 1, name: 'javascript' },
  { id: 2, name: 'typescript' },
  { id: 3, name: 'svelte' }
];
const post = { id: 'ckp1', title: 'T', authorId: 1, reviewerId: null };

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH, ...config } as any);
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users, post: [post], tag: tags, profile: [], follow: [], order: [], line: [],
    auditLog: [], category: [], comment: [], label: [], ...overrides
  };
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

describe('PR4 — endpoint de recherche /_search', () => {
  it('retourne les options paginées pour une relation to-one-owning', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const res = await handler(prisma)({ event, resolve } as any);
    const body = await json(res);
    expect(body.total).toBe(3);
    expect(body.options).toHaveLength(3);
    expect(body.options[0]).toEqual({ id: 1, label: 'Alice' });
  });

  it('filtre par q sur le champ label (insensible à la casse)', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author&q=ALI' });
    const body = await json(await handler(prisma)({ event, resolve } as any));
    expect(body.options).toEqual([{ id: 1, label: 'Alice' }]);
  });

  // Regression (post-review, Task 6 fix round 1): RELATIONS_SCHEMA_PATH is
  // provider=postgresql, so the adapter-wide `caseInsensitiveSearch` resolves
  // `true` at boot (see `resolveCaseInsensitiveSearch`) — but `_search`'s own
  // `q=` clause must NEVER gain `mode: 'insensitive'` from that, on any
  // provider. Before this refactor, `_search` was always case-sensitive at
  // the Prisma-call level (the test above only passes because the MOCK's own
  // `contains` comparison is unconditionally case-insensitive, matching real
  // Prisma's behavior on Postgres with `mode: 'insensitive'` OR without it on
  // a case-insensitive collation — it says nothing about which `where` shape
  // was actually sent). This test inspects the raw call args sent to the
  // Prisma client to prove no `mode` key is ever emitted for this endpoint.
  it("n'émet jamais mode: 'insensitive' sur le where du contains, même avec un provider postgresql (case-sensitive verbatim, comportement inchangé)", async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author&q=ALI' });
    await handler(prisma)({ event, resolve } as any);

    const findManyCalls = callsTo(prisma, 'user', 'findMany');
    const countCalls = callsTo(prisma, 'user', 'count');
    expect(findManyCalls.length).toBeGreaterThan(0);
    expect(countCalls.length).toBeGreaterThan(0);
    for (const call of [...findManyCalls, ...countCalls]) {
      expect(JSON.stringify(call.args)).not.toContain('mode');
    }
  });

  it('fonctionne aussi pour une relation m2m', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.tags&q=script' });
    const body = await json(await handler(prisma)({ event, resolve } as any));
    expect(body.options.map((o: any) => o.label).sort()).toEqual(['javascript', 'typescript']);
  });

  it('respecte le where de scoping configuré sur la relation', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { where: () => ({ email: 'alice@a.c' }) } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const body = await json(await h({ event, resolve } as any));
    expect(body.options).toEqual([{ id: 1, label: 'Alice' }]);
  });

  it('respecte le labelTemplate configuré', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { labelTemplate: '{name} <{email}>' } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const body = await json(await h({ event, resolve } as any));
    // Label brut, PAS échappé HTML : c'est du JSON, pas du HTML.
    expect(body.options[0].label).toBe('Alice <alice@a.c>');
  });

  it('404 sur une relation inconnue', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.nope' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(404);
  });

  it('404 sur un modèle inconnu', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Nope.author' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(404);
  });

  it('404 sur une relation to-many-inverse (pas une cible de select)', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=User.posts' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(404);
  });

  it('404 sur une relation unsupported (FK composite)', async () => {
    const prisma = createPrismaMock(baseData({ order: [{ id: 1, a: 1, b: 2 }], line: [] }));
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Line.order' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(404);
  });

  it('404 sans le paramètre rel', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/_search' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(404);
  });

  it('500 propre si le client cible échoue', async () => {
    const prisma = createPrismaMock(baseData(), {
      user: { findMany: () => { throw new Error('boom'); } }
    });
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const res = await handler(prisma)({ event, resolve } as any);
    expect(res.status).toBe(500);
  });

  it('pagination : respecte ?page=', async () => {
    const manyUsers = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, email: `u${i}@x.y`, name: `U${i}` }));
    const prisma = createPrismaMock(baseData({ user: manyUsers }));
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author&page=2' });
    const body = await json(await handler(prisma)({ event, resolve } as any));
    expect(body.total).toBe(25);
    expect(body.page).toBe(2);
    expect(body.options).toHaveLength(5); // PER_PAGE=20, page 2 -> 5 restants
  });

  it('reste accessible derrière authCheck (auth réussie)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      authCheck: () => true
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const res = await h({ event, resolve } as any);
    expect(res.status).toBe(200);
  });

  it('401 si authCheck refuse', async () => {
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      authCheck: () => false
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/_search?rel=Post.author' });
    const res = await h({ event, resolve } as any);
    expect(res.status).toBe(401);
  });
});
