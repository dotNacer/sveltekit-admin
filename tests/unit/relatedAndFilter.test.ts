import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const users = [
  { id: 1, email: 'alice@a.c', name: 'Alice', bio: null },
  { id: 2, email: 'bob@b.c', name: 'Bob', bio: null }
];
const posts = [
  { id: 'ckp1', title: 'Post A', authorId: 1, reviewerId: null },
  { id: 'ckp2', title: 'Post B', authorId: 1, reviewerId: null },
  { id: 'ckp3', title: 'Post C', authorId: 2, reviewerId: null }
];

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH, ...config } as any);
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users, post: posts, tag: [], profile: [], follow: [], order: [], line: [],
    auditLog: [], category: [], comment: [], label: [], ...overrides
  };
}

describe('PR4 — bloc de liaisons inverses', () => {
  it('affiche un compteur et des liens pour chaque relation inverse', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('Liaisons');
    expect(html).toContain('2 records'); // posts (author) — 2 posts pour alice
    expect(html).toContain('href="/admin/post?filter=authorId:1"');
    expect(html).toContain('href="/admin/post/new?authorId=1"');
  });

  it('compte 0 sans planter quand aucun enregistrement lié', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('0 records');
  });

  it('résilient si le client cible échoue au count', async () => {
    const prisma = createPrismaMock(baseData(), {
      post: { count: () => { throw new Error('boom'); } }
    });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('0 records');
  });

  it('le bloc est absent quand le modèle n\'a aucune relation inverse', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('Liaisons');
  });

  it('N\'affiche pas de bloc pour une relation dont la FK est composite (unsupported)', async () => {
    const prisma = createPrismaMock(baseData({ order: [{ id: 1, a: 1, b: 2 }], line: [] }));
    const { event, resolve } = createEvent({ url: '/admin/order/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('Liaisons');
  });
});

describe('PR4 — filtre de liste (?filter=)', () => {
  it('filtre les résultats sur le champ:valeur donné, coercé en Int', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post?filter=authorId:1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('Post A');
    expect(html).toContain('Post B');
    expect(html).not.toContain('Post C');
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({ where: { authorId: 1 } });
  });

  it('sans ?filter, la liste reste non filtrée', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('Post A');
    expect(html).toContain('Post C');
  });

  it('?filter sur un champ String reste en chaîne (pas de coercion)', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post?filter=title:Post A' });
    await handler(prisma)({ event, resolve } as any);
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({
      where: { title: 'Post A' }
    });
  });
});

describe('PR4 — pré-remplissage FK sur create', () => {
  it('pré-sélectionne la FK depuis la query string', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/new?authorId=2' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('<option value="2" selected="">Bob</option>');
  });

  it('sans query string, aucune présélection', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/new' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('selected>');
  });
});
