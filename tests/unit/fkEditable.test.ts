import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const users = [
  { id: 1, email: 'alice@a.c' },
  { id: 2, email: 'bob@b.c' }
];
const post = { id: 'ckp1', title: 'T', authorId: 1, reviewerId: null };

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH, ...config } as any);
}

function formEvent(url: string, fields: Record<string, string>) {
  return createEvent({ url, body: fields });
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users, post: [post], tag: [], profile: [], follow: [], order: [], line: [],
    auditLog: [], category: [], comment: [], ...overrides
  };
}

describe('PR2 — FK éditables', () => {
  it('le formulaire create rend un select pour la FK', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = createEvent({ url: '/admin/post/new' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('<select id="authorId" name="authorId"');
    expect(html).toContain('alice@a.c');
    expect(html).not.toContain('type="number" name="authorId"');
  });

  it('le formulaire edit présélectionne la valeur courante', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('<option value="1" selected="">alice@a.c</option>');
  });

  it('relation optionnelle : option vide présente', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    const reviewerSelect = html.split('name="reviewerId"')[1];
    expect(reviewerSelect).toContain('<option value="">— aucun —</option>');
  });

  it("relation required : pas d'option vide", async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    const authorSelect = html.split('name="authorId"')[1].split('</select>')[0];
    expect(authorSelect).not.toContain('<option value="">');
  });

  it('au-delà du seuil : raw-id, pas de select', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { relationDefaults: { selectThreshold: 1 } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('<select id="authorId" name="authorId"');
    expect(html).toContain('name="authorId"');
    expect(html).toContain('(ID)');
  });

  it('widget raw-id forcé par config', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Post: { relations: { author: { widget: 'raw-id' } } } } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('<select id="authorId" name="authorId"');
  });

  it('widget hidden : champ absent', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Post: { relations: { author: { widget: 'hidden' } } } } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('authorId');
  });

  it('labelTemplate est utilisé pour les options', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { labelTemplate: '{email} (#{id})' } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('alice@a.c (#1)');
  });

  it('labelTemplate : champ manquant sur la ligne rendu vide, pas "undefined"', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { labelTemplate: '{email}{missing}' } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('>alice@a.c<');
    expect(html).not.toContain('undefined');
  });

  it('POST update : FK écrite directement en scalaire, coercée en Int', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: '2', reviewerId: ''
    });
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'post', 'update')[0];
    expect((update.args as any).data.authorId).toBe(2);
    expect((update.args as any).data.reviewerId).toBeNull();
  });

  it("POST avec ID inexistant : erreur, pas d'écriture", async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: '999'
    });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it("POST vide sur FK required : erreur, pas d'écriture", async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: ''
    });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('required');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('POST avec ID non numérique sur PK Int : erreur', async () => {
    const prisma = createPrismaMock(baseData());
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: 'abc'
    });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('invalid id');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('where de scoping : ID hors du where rejeté (IDOR)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { where: () => ({ email: 'alice@a.c' }) } } } }
    });
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: '2'
    });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it.each([
    'nested Prisma `where` is not supported by the Drizzle adapter',
    "[sveltekit-admin] unknown field 'tenantId' on Drizzle table"
  ])('POST FK échoue fermé si l’adapter refuse de compiler le scope : %s', async (message) => {
    const prisma = createPrismaMock(baseData());
    prisma.user.findFirst = () => {
      throw new Error(message);
    };
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update',
      title: 'T2',
      authorId: '2'
    });

    const html = await (await handler(prisma)({ event, resolve } as any)).text();

    expect(html).toContain('author: invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('FK ignore une erreur adapter générique quand aucun scope n’est configuré', async () => {
    const prisma = createPrismaMock(baseData());
    prisma.user.findFirst = () => { throw new Error('adapter unavailable'); };
    const { event, resolve } = formEvent('/admin/post/ckp1', {
      _action: 'update', title: 'T2', authorId: '2'
    });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('author: invalid value');
    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
  });

  it('where de scoping : limité aussi aux options du select', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { author: { where: () => ({ email: 'alice@a.c' }) } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    const authorSelect = html.split('name="authorId"')[1].split('</select>')[0];
    expect(authorSelect).toContain('alice@a.c');
    expect(authorSelect).not.toContain('bob@b.c');
  });

  it('cible de relation absente du client : repli raw-id', async () => {
    const prisma = createPrismaMock(baseData({ user: undefined as any }));
    delete (prisma as any).user;
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('name="authorId"');
    expect(html).not.toContain('<select id="authorId" name="authorId"');
  });

  it('nullLabel personnalisé', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Post: { relations: { reviewer: { nullLabel: '— personne —' } } } }
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('— personne —');
  });

  it('label replié sur la PK quand aucun champ candidat n\'est présent', async () => {
    const prisma = createPrismaMock(
      baseData({ tag: [{ id: 1, name: 'x' }] })
    );
    // Tag a bien `name`, donc on scope labelFields sur un champ absent
    // pour forcer le repli sur la PK.
    const h = handler(prisma, { relationDefaults: { labelFields: ['nope'] } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    const authorSelect = html.split('name="authorId"')[1].split('</select>')[0];
    // Sans champ candidat, le label retombe sur la valeur de la PK (id).
    expect(authorSelect).toContain('>1</option>');
  });

  it('raw-id optionnel : pas de required sur l\'input', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { relationDefaults: { selectThreshold: 1 } });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    const reviewerArea = html.split('name="reviewerId"')[1].split('>')[0];
    expect(reviewerArea).not.toContain('required');
  });

  it('POST update : coercion vers une PK cible de type String (non-Int)', async () => {
    const prisma = createPrismaMock(
      baseData({ comment: [{ id: 1, body: 'x', createdBy: 'a', postId: 'ckp1' }] })
    );
    const { event, resolve } = formEvent('/admin/comment/1', {
      _action: 'update', body: 'y', createdBy: 'a', postId: 'ckp1'
    });
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'comment', 'update')[0];
    expect((update.args as any).data.postId).toBe('ckp1');
  });

  it('FK composite (unsupported) : pas de validation relation, écriture brute', async () => {
    const prisma = createPrismaMock(
      baseData({ line: [{ id: 1, orderA: 1, orderB: 2 }] })
    );
    const { event, resolve } = formEvent('/admin/line/1', {
      _action: 'update', orderA: '5', orderB: '6'
    });
    await handler(prisma)({ event, resolve } as any);
    const update = callsTo(prisma, 'line', 'update')[0];
    expect((update.args as any).data.orderA).toBe(5);
    expect((update.args as any).data.orderB).toBe(6);
  });

  it('FK composite (unsupported) : pas de select rendu dans le formulaire', async () => {
    const prisma = createPrismaMock(
      baseData({ line: [{ id: 1, orderA: 1, orderB: 2 }], order: [] })
    );
    const { event, resolve } = createEvent({ url: '/admin/line/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('<select id="order" name="order"');
  });

  it('schéma introuvable : la relation n\'est simplement pas gérée (pas de crash)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({ prisma, prismaSchemaPath: '/tmp/does-not-exist.prisma' });
    const { event, resolve } = createEvent({ url: '/admin/post/ckp1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('not found');
  });

  it('POST create : champ FK absent du formulaire, non touché', async () => {
    const prisma = createPrismaMock(baseData({ post: [] }));
    const { event, resolve } = formEvent('/admin/post/new', {
      _action: 'create', title: 'T', authorId: '1'
    });
    await handler(prisma)({ event, resolve } as any);
    const create = callsTo(prisma, 'post', 'create')[0];
    // reviewerId n'a pas été soumis : ni null forcé, ni erreur.
    expect((create.args as any).data.reviewerId).toBeUndefined();
  });

  it('self-referential : ne peut pas se référencer soi-même', async () => {
    const prisma = createPrismaMock(
      baseData({ category: [{ id: 1, name: 'Root', parentId: null }] })
    );
    const { event, resolve } = formEvent('/admin/category/1', {
      _action: 'update', name: 'Root', parentId: '1'
    });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('cannot reference itself');
  });
});
