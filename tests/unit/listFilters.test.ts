import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, SEARCH_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const articles = [
  { id: 1, title: 'A', published: true, status: 'PUBLISHED', views: 10 },
  { id: 2, title: 'B', published: false, status: 'DRAFT', views: 5 },
  { id: 3, title: 'C', published: true, status: 'ARCHIVED', views: 2 }
];

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH, ...config } as any);
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return { article: articles, ...overrides };
}

describe('PR2 — sidebar de filtres, auto-détection', () => {
  it('rend une sidebar avec role/published pour un modèle qui a Boolean + enum', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('ska-filters');
    expect(html).toContain('href="/admin/article?f.published=true"');
    expect(html).toContain('href="/admin/article?f.status=DRAFT"');
  });

  it('un clic sur "Yes" (Boolean) filtre réellement la liste', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.published=true' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(callsTo(prisma, 'article', 'findMany')[0].args).toMatchObject({ where: { published: true } });
    expect(html).toContain('>A<');
    expect(html).not.toContain('>B<');
  });

  it('l\'entrée active porte aria-current="page"', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.status=DRAFT' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toMatch(/href="\/admin\/article\?f\.status=DRAFT" class="ska-filters__link ska-filters__link--active" aria-current="page"/);
  });

  it('sans filtre actif, "All" est l\'entrée active', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toMatch(/href="\/admin\/article" class="ska-filters__link ska-filters__link--active"/);
  });

  it('modèle sans champ Boolean/enum filtrable : pas de sidebar', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c', name: 'A', bio: null }], post: [], tag: [], profile: [], follow: [], order: [], line: [], auditLog: [], category: [], comment: [], label: [] });
    const h = createAdminHandler({ prisma, prismaSchemaPath: 'tests/fixtures/schemas/relations.prisma' } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toMatch(/class="ska-filters__group"/);
  });
});

describe('PR2 — configuration explicite listFilter', () => {
  it('config explicite : seuls les champs listés apparaissent, dans l\'ordre déclaré', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: ['status'] } } });
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('f.status=');
    expect(html).not.toContain('f.published=');
  });

  it('label personnalisé (forme objet)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Article: { listFilter: [{ field: 'published', label: 'Publié ?' }] } }
    });
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Publié ?');
  });

  it('config invalide (champ inexistant) lève une erreur au démarrage', () => {
    const prisma = createPrismaMock(baseData());
    expect(() =>
      handler(prisma, { models: { Article: { listFilter: ['nope'] } } })
    ).toThrow(/no field "nope"/);
  });

  it('config invalide (champ sensible) lève une erreur au démarrage', () => {
    const prisma = createPrismaMock(baseData());
    expect(() =>
      handler(prisma, { models: { Article: { listFilter: ['apiToken'] } } })
    ).toThrow(/sensitive/);
  });

  it('config invalide (type non supporté) lève une erreur au démarrage', () => {
    const prisma = createPrismaMock(baseData());
    expect(() =>
      handler(prisma, { models: { Article: { listFilter: ['title'] } } })
    ).toThrow(/only Boolean and enum/);
  });

  it('sans listFilter configuré pour ce modèle, aucune validation ne se déclenche (autre modèle configuré)', async () => {
    // Couvre `if (entries) validateListFilterConfig(...)` côté négatif :
    // un modèle SANS listFilter dans la config ne doit jamais appeler la
    // validation, même quand un AUTRE modèle en a une.
    const prisma = createPrismaMock(baseData());
    expect(() =>
      handler(prisma, { models: { Article: { listFilter: ['status'] } } })
    ).not.toThrow();
  });
});

describe('PR2 — deux filtres actifs combinés', () => {
  it('deux filtres (Boolean + enum) se combinent en AND', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.published=true&f.status=ARCHIVED' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(callsTo(prisma, 'article', 'findMany')[0].args).toMatchObject({
      where: { AND: [{ published: true }, { status: 'ARCHIVED' }] }
    });
    expect(html).toContain('>C<');
    expect(html).not.toContain('>A<');
  });
});
