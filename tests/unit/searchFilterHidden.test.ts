import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, SEARCH_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Régression pour un bug bloquant trouvé en review post-livraison :
 * `hidden` (config par modèle qui masque un champ à l'AFFICHAGE) n'était
 * vérifié nulle part dans le pipeline de recherche/filtre. Un champ listé
 * dans `hidden` restait un oracle de confirmation de valeur exploitable via
 * `?f.<field>=...` ou `?q=...`, exactement la faille §0.a fermée ailleurs
 * pour les champs sensibles par nom — `hidden` est une DEUXIÈME source
 * indépendante qui doit fermer le même oracle (docs/design §3.5/§10).
 *
 * Ces tests reproduisent le scénario exact utilisé lors de la review :
 * un modèle avec `hidden: ['content']`, une valeur secrète dans `content`,
 * et une tentative de la retrouver via une requête forgée.
 */

const posts = [
  { id: 'post-a', title: 'A', content: 'SECRET-DRAFT-CONTENT', authorId: 1, reviewerId: null },
  { id: 'post-b', title: 'B', content: 'other', authorId: 1, reviewerId: null }
];

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: [{ id: 1, email: 'a@b.c', name: 'A', bio: null }],
    post: posts,
    tag: [], label: [], profile: [], follow: [], order: [], line: [], auditLog: [], category: [], comment: [],
    ...overrides
  };
}

describe('hidden field is never a filter/search oracle (post-review regression)', () => {
  it('a `hidden` field is not filterable via ?f.<field>=... — the where stays empty, not a value-confirmation oracle', async () => {
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: { hidden: ['content'] } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/post?f.content=SECRET-DRAFT-CONTENT' });
    const html = await (await h({ event, resolve } as any)).text();

    // Bug tel que trouvé en review : le where forgé passait tel quel, la
    // page affichait "1 records" — confirmant que la valeur exacte existe
    // en base malgré le champ masqué. Après fix : le filtre est ignoré,
    // le where ne contient jamais `content`, la liste reste non filtrée.
    expect(callsTo(prisma, 'post', 'findMany')[0].args).not.toHaveProperty('where.content');
    expect(html).toContain('2 records');
  });

  it('a `hidden` field is not usable via ?q= either — no `contains` oracle through free-text search', async () => {
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: { hidden: ['content'], searchFields: ['content', 'title'] } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/post?q=SECRET-DRAFT' });
    const html = await (await h({ event, resolve } as any)).text();

    // `content` est retiré de searchFields malgré la config explicite ;
    // seul `title` reste cherchable, donc aucun match sur "SECRET-DRAFT".
    const call = callsTo(prisma, 'post', 'findMany')[0]?.args as any;
    expect(JSON.stringify(call?.where ?? {})).not.toContain('content');
    expect(html).toContain('0 records');
  });

  it('a `hidden` Boolean field is never auto-detected in the filter sidebar', async () => {
    const prisma = createPrismaMock({
      article: [{ id: 1, title: 'A', published: true, status: 'PUBLISHED', views: 1, price: 1, createdAt: new Date() }]
    });
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: SEARCH_SCHEMA_PATH,
      models: { Article: { hidden: ['published'] } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('f.published=');
  });

  it('explicitly configuring a `hidden` field in listFilter throws at boot, not at request time', () => {
    const prisma = createPrismaMock(baseData());
    expect(() =>
      createAdminHandler({
        prisma,
        prismaSchemaPath: RELATIONS_SCHEMA_PATH,
        models: { Post: { hidden: ['content'], listFilter: ['content'] } }
      } as any)
    ).toThrow(/is listed in `hidden`/);
  });
});
