import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const USERS = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  email: `user${i + 1}@example.com`,
  name: i % 2 === 0 ? `User ${i + 1}` : null,
  password: 'secret',
  bio: i === 0 ? "Long bio with an apostrophe: o'brien" : null,
  role: 'USER',
  isActive: true,
  balance: '10.50',
  visits: 3n.toString(),
  rating: 4.5,
  metadata: i === 0 ? { theme: 'dark' } : null,
  createdAt: new Date('2026-01-15T10:30:00.000Z'),
  updatedAt: new Date('2026-02-20T08:00:00.000Z')
}));

const POSTS = [{ id: 'ckpost1', title: 'Hello', content: null, published: true, publishedAt: null, authorId: 1 }];

function run(url: string, opts: { body?: Record<string, string>; prisma?: any; config?: any } = {}) {
  const prisma = opts.prisma ?? createPrismaMock({ user: USERS, post: POSTS, category: [] });
  const handler = createAdminHandler({
    prisma,
    prismaSchemaPath: FULL_SCHEMA_PATH,
    branding: { title: 'Test Admin', primaryColor: '#ff0055' },
    models: { User: { label: 'Utilisateurs', hidden: ['password'] } },
    ...opts.config
  });
  const { event, resolve } = createEvent({ url, body: opts.body });
  return handler({ event, resolve } as any);
}

// Deux normalisations, sans lesquelles les snapshots ne seraient pas reproductibles :
// - les espaces de fin de ligne, que les templates produisent en abondance ;
// - les dates, que `formatValue` rend via `toLocaleString()` — donc dépendantes du
//   fuseau ET de la locale de la machine. Le rendu des dates est couvert
//   directement par les tests de `formatValue` en Task 12 ; ici il est neutralisé.
const DATE_LIKE = /\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4},?\s+\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?/g;

async function html(res: Response) {
  return (await res.text()).replace(/\s+$/gm, '').replace(DATE_LIKE, '<DATE>');
}

describe('caractérisation du handler', () => {
  it('01 dashboard', async () => expect(await html(await run('/admin'))).toMatchSnapshot());
  it('02 dashboard avec slash final', async () => expect(await html(await run('/admin/'))).toMatchSnapshot());
  it('03 liste page 1', async () => expect(await html(await run('/admin/user'))).toMatchSnapshot());
  it('04 liste page 2', async () => expect(await html(await run('/admin/user?page=2'))).toMatchSnapshot());
  it('05 liste vide', async () => expect(await html(await run('/admin/category'))).toMatchSnapshot());
  it('06 formulaire de création', async () => expect(await html(await run('/admin/user/new'))).toMatchSnapshot());
  it('07 formulaire d’édition, PK Int', async () => expect(await html(await run('/admin/user/1'))).toMatchSnapshot());
  it('08 formulaire d’édition, PK String', async () => expect(await html(await run('/admin/post/ckpost1'))).toMatchSnapshot());
  it('09 modèle inconnu', async () => expect(await html(await run('/admin/nope'))).toMatchSnapshot());
  it('10 id inexistant', async () => expect(await html(await run('/admin/user/999'))).toMatchSnapshot());

  it('11 création POST redirige', async () => {
    const res = await run('/admin/user/new', { body: { _action: 'create', email: 'new@example.com', password: 'p' } });
    expect({ status: res.status, location: res.headers.get('Location') }).toMatchSnapshot();
  });

  it('12 mise à jour POST redirige', async () => {
    const res = await run('/admin/user/1', { body: { _action: 'update', email: 'up@example.com' } });
    expect({ status: res.status, location: res.headers.get('Location') }).toMatchSnapshot();
  });

  it('13 suppression POST redirige', async () => {
    const res = await run('/admin/user/1', { body: { _action: 'delete' } });
    expect({ status: res.status, location: res.headers.get('Location') }).toMatchSnapshot();
  });

  it('14 erreur prisma rendue en alerte', async () => {
    const prisma = createPrismaMock({ user: USERS }, { user: { findMany: () => { throw new Error('DB is down <b>'); } } });
    expect(await html(await run('/admin/user', { prisma }))).toMatchSnapshot();
  });

  it('15 auth refusée', async () => {
    const res = await run('/admin', { config: { authCheck: () => false } });
    expect({ status: res.status, body: await res.text() }).toMatchSnapshot();
  });
});
