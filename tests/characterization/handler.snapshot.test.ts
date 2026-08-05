import { describe, it, expect, afterEach, vi } from 'vitest';
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
// La classe de chiffres couvre l'ASCII, l'arabe-indic (٠-٩) et l'arabe-indic étendu /
// persan (۰-۹) : `toLocaleString('ar-SA')` ou `('fa-IR')` rendent leurs propres
// chiffres, et TZ est figé mais pas la locale par défaut de la machine CI.
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const DATE_LIKE = new RegExp(
  `${DIGIT}{1,4}[/\\-.]${DIGIT}{1,2}[/\\-.]${DIGIT}{1,4},?\\s+${DIGIT}{1,2}:${DIGIT}{2}(:${DIGIT}{2})?(\\s?[AP]M)?`,
  'g'
);

// Le bloc <style> est un template statique de ~300 lignes, sauf les deux lignes
// `:root { --ska-primary / --ska-primary-hover }` qui interpolent la couleur de
// branding et sa teinte de survol via `adjustColor` — c'est justement ce que Task 5
// extrait. On garde ces deux valeurs concrètes visibles dans le snapshot (couvertes
// aussi, plus tard, par les tests unitaires de layout et `adjustColor`), et on ne
// remplace que le reste, statique, du bloc.
async function html(res: Response) {
  return (await res.text())
    .replace(/\s+$/gm, '')
    .replace(DATE_LIKE, '<DATE>')
    .replace(/(<style>\s*:root\s*\{[^}]*\})[\s\S]*?(<\/style>)/, '$1/* stripped: static CSS, see note */$2');
}

describe('caractérisation du handler', () => {
  afterEach(() => vi.restoreAllMocks());

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
    // Le handler journalise l'erreur via console.error — comportement voulu, mais
    // dont la stack trace polluerait la sortie de chaque exécution du suite.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ user: USERS }, { user: { findMany: () => { throw new Error('DB is down <b>'); } } });
    expect(await html(await run('/admin/user', { prisma }))).toMatchSnapshot();
  });

  it('15 auth refusée', async () => {
    const res = await run('/admin', { config: { authCheck: () => false } });
    expect({ status: res.status, body: await res.text() }).toMatchSnapshot();
  });

  it('16 liste avec une colonne date', async () => {
    const config = { models: { User: { label: 'Utilisateurs', listFields: ['email', 'createdAt'] } } };
    expect(await html(await run('/admin/user', { config }))).toMatchSnapshot();
  });

  it('17 hors basePath délègue à resolve', async () => {
    const { event, resolve } = createEvent({ url: '/public/page' });
    const handler = createAdminHandler({
      prisma: createPrismaMock({ user: [], post: [], category: [] }),
      prismaSchemaPath: FULL_SCHEMA_PATH
    });
    const res = await handler({ event, resolve } as any);
    expect({ resolveCalled: resolve.called, body: await res.text() }).toMatchSnapshot();
  });
});
