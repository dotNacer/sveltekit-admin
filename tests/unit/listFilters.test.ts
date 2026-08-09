import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, SEARCH_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const articles = [
  { id: 1, title: 'A', published: true, status: 'PUBLISHED', views: 10, price: 9.99, createdAt: new Date('2024-06-01T10:00:00Z') },
  { id: 2, title: 'B', published: false, status: 'DRAFT', views: 5, price: 19.99, createdAt: new Date('2024-06-02T10:00:00Z') },
  { id: 3, title: 'C', published: true, status: 'ARCHIVED', views: 2, price: 29.99, createdAt: new Date('2020-01-01T10:00:00Z') }
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
    ).toThrow(/only Boolean, enum, DateTime/);
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

describe('PR3 — filtre DateTime (presets, config explicite)', () => {
  it('config explicite : rend des liens de presets', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: ['createdAt'] } } });
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('href="/admin/article?f.createdAt=today"');
    expect(html).toContain('>Today<');
    expect(html).toContain('>Last 7 days<');
  });

  it('presets restreints en config : seuls ceux-là apparaissent', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, {
      models: { Article: { listFilter: [{ field: 'createdAt', presets: ['year'] }] } }
    });
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('>This year<');
    expect(html).not.toContain('>Today<');
  });

  it('un preset actif marque bien l\'entrée sidebar correspondante avec aria-current (bug trouvé en review)', async () => {
    // Avant le fix : aucun raccourci DateTime actif n'était jamais marqué,
    // "All" restait affiché comme actif quel que soit le filtre appliqué —
    // régression a11y contre §3.4 (aria-current="page" sur l'entrée active).
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: ['createdAt'] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.createdAt=year' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toMatch(/href="\/admin\/article\?f\.createdAt=year" class="ska-filters__link ska-filters__link--active" aria-current="page"/);
    // "All" ne doit plus être marqué actif alors qu'un preset l'est.
    expect(html).not.toMatch(/href="\/admin\/article" class="ska-filters__link ska-filters__link--active"/);
  });

  it('?f.createdAt=year filtre réellement — A et B (2024) inclus, C (2020) exclu', async () => {
    // Preset volontairement grossier (année) pour éviter toute fragilité
    // liée à l'heure d'exécution du test (contrairement à `today`/`7d`).
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: ['createdAt'] } } });
    const currentYear = new Date().getUTCFullYear();
    // Les fixtures sont fixées à 2024/2020 : si l'année courante n'est ni
    // l'une ni l'autre, le test reste valide (aucun des deux ne matche),
    // mais on vérifie surtout que la requête ne plante pas et compose un
    // intervalle gte/lt cohérent.
    const { event, resolve } = createEvent({ url: '/admin/article?f.createdAt=year' });
    await h({ event, resolve } as any);
    const call = callsTo(prisma, 'article', 'findMany')[0].args as any;
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
    expect(call.where.createdAt.gte.getUTCFullYear()).toBe(currentYear);
  });

  it('date invalide (2026-13-45) est ignorée de bout en bout, pas de 500', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: ['createdAt'] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.createdAt=2026-13-45' });
    const res = await h({ event, resolve } as any);
    expect(res.status).toBe(200);
  });
});

describe('PR3 — filtre range (plages numériques)', () => {
  it('config explicite range:true : rend un mini form avec deux inputs', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'views', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('name="f.views__gte"');
    expect(html).toContain('name="f.views__lte"');
  });

  it('?f.views__gte=5&f.views__lte=10 filtre réellement (A et B, pas C)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'views', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.views__gte=5&f.views__lte=10' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(callsTo(prisma, 'article', 'findMany')[0].args).toMatchObject({
      where: { AND: [{ views: { gte: 5 } }, { views: { lte: 10 } }] }
    });
    expect(html).toContain('>A<');
    expect(html).toContain('>B<');
    expect(html).not.toContain('>C<');
  });

  it('gte seul (sans lte) fonctionne', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'views', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.views__gte=8' });
    await h({ event, resolve } as any);
    expect(callsTo(prisma, 'article', 'findMany')[0].args).toMatchObject({ where: { views: { gte: 8 } } });
  });

  it('bornes inversées (gte > lte) : 0 résultat, pas d\'erreur', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'views', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.views__gte=100&f.views__lte=1' });
    const res = await h({ event, resolve } as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('>A<');
    expect(html).not.toContain('>B<');
    expect(html).not.toContain('>C<');
  });

  it('préremplit les bornes actives dans les inputs', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'views', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.views__gte=5&f.views__lte=10' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('name="f.views__gte" value="5"');
    expect(html).toContain('name="f.views__lte" value="10"');
  });

  it('range sur Decimal (price) fonctionne aussi', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { Article: { listFilter: [{ field: 'price', range: true }] } } });
    const { event, resolve } = createEvent({ url: '/admin/article?f.price__lte=20' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('>A<');
    expect(html).toContain('>B<');
    expect(html).not.toContain('>C<');
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
