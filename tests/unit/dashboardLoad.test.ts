import { describe, it, expect } from 'vitest';
import { loadDashboard } from '../../src/lib/server/dashboard.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

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

  it('refuse encore de charger un widget count — livré par la tâche suivante', async () => {
    const { runtime } = runtimeWith({
      dashboard: { widgets: [{ type: 'count', model: 'User', label: 'Actifs' }] }
    });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /widget "Actifs" \(type "count"\) cannot be loaded yet/
    );
  });
});
