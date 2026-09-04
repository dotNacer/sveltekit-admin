import { describe, it, expect } from 'vitest';
import { loadDashboard } from '../../src/lib/server/dashboard.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { OPAQUE_FILTER_ERROR } from '../../src/lib/server/adapters/filter.js';

const DATA = {
  user: [
    { id: 1, email: 'a@x.y', name: 'A', password: 'secret', isActive: true },
    { id: 2, email: 'b@x.y', name: 'B', password: 'secret', isActive: false }
  ],
  post: [{ id: 'p1', title: 'Hello', authorId: 1 }],
  category: []
};

const runtimeWith = (config: Record<string, unknown> = {}, prisma = createPrismaMock(DATA)) => ({
  prisma,
  runtime: createAdminRuntime({
    adapter: createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH }),
    ...config
  } as any)
});

describe('loadDashboard', () => {
  it('compte chaque modèle et totalise pour le widget stats', async () => {
    const { runtime } = runtimeWith();
    const { rows, title } = await loadDashboard(runtime, { locals: {} });
    expect(title).toBe('Dashboard');
    expect(rows[0]).toEqual({
      kind: 'cards',
      cards: [
        { value: 3, label: 'Models', icon: 'models' },
        { value: 3, label: 'Total Records', icon: 'records' }
      ]
    });
  });

  it('construit les liens de chaque carte modèle', async () => {
    const { runtime } = runtimeWith();
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows[1]).toEqual({
      kind: 'models',
      title: 'Models',
      cards: [
        { name: 'User', label: 'User', count: 2, href: '/admin/user', newHref: '/admin/user/new' },
        { name: 'Post', label: 'Post', count: 1, href: '/admin/post', newHref: '/admin/post/new' },
        {
          name: 'Category',
          label: 'Category',
          count: 0,
          href: '/admin/category',
          newHref: '/admin/category/new'
        }
      ]
    });
  });

  it('ne compte qu’une fois un modèle présent dans deux widgets', async () => {
    const { runtime, prisma } = runtimeWith({
      dashboard: {
        widgets: [
          { type: 'stats' },
          { type: 'models', models: ['User'] },
          { type: 'models', models: ['User', 'Post'] }
        ]
      }
    });
    await loadDashboard(runtime, { locals: {} });
    expect(callsTo(prisma, 'user', 'count')).toHaveLength(1);
  });

  it('compose le scope du modèle dans chaque comptage', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ isActive: true }) } }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const userCard = (rows[1] as any).cards.find((c: any) => c.name === 'User');
    expect(userCard.count).toBe(1);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: { isActive: true } });
  });

  it('affiche 0 quand la table n’existe pas encore', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith({}, prisma);
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[1] as any).cards[0].count).toBe(0);
  });

  it('laisse remonter un scope qui échouerait ouvert', async () => {
    const { runtime } = runtimeWith({ models: { User: { scope: () => ({}) } } });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /must return a non-empty condition/
    );
  });

  it('compte selon la query du widget et lie vers la liste filtrée', async () => {
    const { runtime } = runtimeWith({
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows).toEqual([
      {
        kind: 'cards',
        cards: [
          { value: 1, label: 'Actifs', icon: 'filter', href: '/admin/user?f.isActive=true' }
        ]
      }
    ]);
  });

  it('aligne des compteurs consécutifs dans une seule rangée', async () => {
    const { runtime } = runtimeWith({
      dashboard: {
        widgets: [
          { type: 'stats' },
          { type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' },
          { type: 'count', model: 'Post', label: 'Posts' }
        ]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).cards).toHaveLength(4);
  });

  it('compose le scope du modèle avec la query du compteur', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ id: 2 }) } },
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    // L'utilisateur 2 est inactif : le scope et le filtre sont bien tous les
    // deux appliqués, pas l'un à la place de l'autre.
    expect((rows[0] as any).cards[0].value).toBe(0);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({
      where: { AND: [{ id: 2 }, { isActive: true }] }
    });
  });

  it('affiche 0 quand le comptage filtré échoue', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'count', model: 'User', label: 'Actifs' }] } },
      prisma
    );
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).cards[0].value).toBe(0);
  });

  it('laisse remonter un scope de compteur qui échouerait ouvert', async () => {
    const { runtime } = runtimeWith({
      models: { User: { scope: () => ({}) } },
      dashboard: { widgets: [{ type: 'count', model: 'User', label: 'Actifs' }] }
    });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /must return a non-empty condition/
    );
  });

  it('applique aussi listWhere aux comptages du dashboard', async () => {
    const { runtime } = runtimeWith({
      models: { User: { listWhere: () => ({ isActive: true }) } }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const userCard = (rows[1] as any).cards.find((c: any) => c.name === 'User');
    // Sans cette composition, la carte annoncerait 2 alors que la liste vers
    // laquelle elle pointe n'en montre qu'un.
    expect(userCard.count).toBe(1);
  });

  it('laisse remonter un listWhere qui échouerait ouvert', async () => {
    const { runtime } = runtimeWith({ models: { User: { listWhere: () => ({}) } } });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /returned an empty object/
    );
  });

  it('applique aussi listWhere au comptage d’un widget count', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { listWhere: () => ({ isActive: true }) } },
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Tous', query: '' }]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    // Le widget ne filtre sur rien lui-même : sans composer listWhere, il
    // compterait les 2 users au lieu du seul actif.
    expect((rows[0] as any).cards[0].value).toBe(1);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: { isActive: true } });
  });

  it('compose scope ET listWhere ensemble pour un comptage', async () => {
    const { runtime, prisma } = runtimeWith({
      models: {
        User: { scope: () => ({ id: 1 }), listWhere: () => ({ isActive: true }) }
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const userCard = (rows[1] as any).cards.find((c: any) => c.name === 'User');
    expect(userCard.count).toBe(1);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({
      where: { AND: [{ id: 1 }, { isActive: true }] }
    });
  });

  it('laisse remonter une erreur de filtre opaque (Drizzle) plutôt que de la rendre 0', async () => {
    // Distinct de « affiche 0 quand la table n'existe pas encore » : seule une
    // table absente est tolérée par ce catch, pas un `listWhere` opaque
    // refusé par l'adaptateur Drizzle — sinon une erreur de configuration se
    // rendrait silencieusement 0 sur chaque carte modèle.
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error(OPAQUE_FILTER_ERROR);
        }
      }
    });
    const { runtime } = runtimeWith({}, prisma);
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(OPAQUE_FILTER_ERROR);
  });

  it('laisse remonter une erreur de filtre opaque (Drizzle) sur un widget count plutôt que de la rendre 0', async () => {
    // Même distinction que ci-dessus, pour la branche `count` : voir
    // « affiche 0 quand le comptage filtré échoue » pour le cas toléré.
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error(OPAQUE_FILTER_ERROR);
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'count', model: 'User', label: 'Actifs' }] } },
      prisma
    );
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(OPAQUE_FILTER_ERROR);
  });

  // Le mock `createPrismaMock.findMany` ignore `orderBy` (filtre par `where`
  // puis tranche) : lui apprendre à trier ferait bouger l'ordre de chaque
  // autre test de liste et des snapshots de caractérisation. On vérifie donc
  // le CONTRAT de tri (ce que `findMany` a reçu), pas un ordre que le mock ne
  // peut pas produire ; l'ordre observable réel est couvert par le test
  // d'intégration SQLite de la tâche suivante.
  it('demande le tri décroissant sur la clé primaire et respecte la limite', async () => {
    const { runtime, prisma } = runtimeWith({
      dashboard: { widgets: [{ type: 'recent', model: 'User', limit: 1 }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({
      orderBy: { id: 'desc' },
      take: 1
    });
    // Le mock ne trie pas : `take: 1` sur `[A, B]` non trié renvoie `A`, pas
    // le plus récent. On affirme donc le mapping des lignes que le mock rend
    // réellement, dans son ordre à lui.
    expect(rows).toEqual([
      {
        kind: 'recent',
        title: 'Latest User',
        href: '/admin/user',
        items: [{ label: 'A', href: '/admin/user/1' }]
      }
    ]);
  });

  it('n’expose ni champ sensible ni champ masqué dans un libellé', async () => {
    const { runtime } = runtimeWith({
      models: { User: { hidden: ['name'] } },
      dashboard: { widgets: [{ type: 'recent', model: 'User', limit: 2 }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const labels = (rows[0] as any).items.map((i: any) => i.label);
    // `name` est masqué : le label retombe sur `email`, jamais sur le mot de
    // passe ni sur le champ masqué. Ordre du mock (non trié) : A puis B.
    expect(labels).toEqual(['a@x.y', 'b@x.y']);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('scope la lecture des récents', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ isActive: true }) } },
      dashboard: { widgets: [{ type: 'recent', model: 'User' }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).items).toEqual([{ label: 'A', href: '/admin/user/1' }]);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({
      where: { isActive: true },
      take: 5
    });
  });

  it('rend un panneau vide quand aucun enregistrement ne correspond', async () => {
    const { runtime } = runtimeWith({
      dashboard: { widgets: [{ type: 'recent', model: 'Category' }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).items).toEqual([]);
  });

  it('rend une liste vide quand la table n’existe pas encore', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        findMany: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'recent', model: 'User' }] } },
      prisma
    );
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).items).toEqual([]);
  });

  it('laisse remonter une erreur de filtre opaque (Drizzle) sur un widget recent plutôt que de la rendre vide', async () => {
    // Même distinction que pour `stats`/`count` : seule une table absente est
    // tolérée par ce catch, pas un `listWhere` opaque refusé par l'adaptateur
    // Drizzle.
    const prisma = createPrismaMock(DATA, {
      user: {
        findMany: () => {
          throw new Error(OPAQUE_FILTER_ERROR);
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'recent', model: 'User' }] } },
      prisma
    );
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(OPAQUE_FILTER_ERROR);
  });
});
