import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';
import { parseSortQuery } from '../../src/lib/server/query/sortQuery.js';

/**
 * `models[].defaultSort` fixe l'ordre d'arrivée sur la liste. Validé au
 * démarrage comme `listFilter` : une colonne inexistante ou non triable est
 * une erreur de développeur, elle doit échouer fort plutôt que produire un tri
 * silencieusement mort à chaque rendu.
 */

const USERS = [{ id: 1, email: 'a@b.c', name: 'A' }];

const build = (defaultSort: unknown) => {
  const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
  return {
    prisma,
    handler: createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      models: { User: { defaultSort } }
    } as any)
  };
};

const orderByOf = (prisma: any) => (callsTo(prisma, 'user', 'findMany')[0].args as any).orderBy;

describe('parseSortQuery avec un tri par défaut', () => {
  const sortable = ['email', 'name'];
  const fallback = { field: 'name' as const, dir: 'asc' as const };

  it('applique le défaut quand l’URL ne demande rien', () => {
    expect(parseSortQuery(new URLSearchParams(''), sortable, fallback).active).toEqual(fallback);
  });

  it('laisse l’URL gagner sur le défaut', () => {
    expect(parseSortQuery(new URLSearchParams('sort=email'), sortable, fallback).active)
      .toEqual({ field: 'email', dir: 'asc' });
  });

  it('retombe sur le défaut quand l’URL demande une colonne refusée', () => {
    const state = parseSortQuery(new URLSearchParams('sort=nope'), sortable, fallback);
    expect(state.active).toEqual(fallback);
    expect(state.ignored).toBe(true);
  });
});

describe('models[].defaultSort', () => {
  it('ordonne la liste sans paramètre dans l’URL', async () => {
    const { prisma, handler } = build({ field: 'name' });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    await handler({ event, resolve } as any);

    expect(orderByOf(prisma)).toEqual([{ name: 'asc' }, { id: 'desc' }]);
  });

  it('accepte une direction explicite', async () => {
    const { prisma, handler } = build({ field: 'name', dir: 'desc' });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    await handler({ event, resolve } as any);

    expect(orderByOf(prisma)[0]).toEqual({ name: 'desc' });
  });

  it('laisse un ?sort= explicite l’emporter', async () => {
    const { prisma, handler } = build({ field: 'name' });
    const { event, resolve } = createEvent({ url: '/admin/user?sort=email' });
    await handler({ event, resolve } as any);

    expect(orderByOf(prisma)[0]).toEqual({ email: 'asc' });
  });

  it('marque la colonne par défaut comme triée dans l’en-tête', async () => {
    const { handler } = build({ field: 'name' });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await handler({ event, resolve } as any)).text();

    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*><a[^>]*>name/);
  });

  it('refuse au démarrage une colonne inexistante', () => {
    expect(() => build({ field: 'nope' })).toThrow(/defaultSort/);
  });

  it('refuse au démarrage une colonne que la liste n’affiche pas', () => {
    // `password` est écarté par l'heuristique de nom : le trier n'aurait aucun
    // en-tête pour l'annoncer, et l'utilisateur n'aurait aucun moyen d'en sortir.
    expect(() => build({ field: 'password' })).toThrow(/defaultSort/);
  });

  it('refuse au démarrage une direction inconnue', () => {
    expect(() => build({ field: 'name', dir: 'sideways' })).toThrow(/defaultSort/);
  });

  it('garde le tri PK desc sans configuration', async () => {
    const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    await handler({ event, resolve } as any);

    expect(orderByOf(prisma)).toEqual({ id: 'desc' });
  });
});
