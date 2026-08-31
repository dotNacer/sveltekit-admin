import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const USERS = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, email: `u${i}@x.y` }));

const build = (config: Record<string, unknown> = {}) => {
  const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
  return {
    prisma,
    handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any)
  };
};

const takeOf = (prisma: any) => (callsTo(prisma, 'user', 'findMany')[0].args as any).take;
const listOf = async (config: Record<string, unknown>, url = '/admin/user') => {
  const { prisma, handler } = build(config);
  const { event, resolve } = createEvent({ url });
  const html = await (await handler({ event, resolve } as any)).text();
  return { prisma, html };
};

describe('taille de page configurée', () => {
  it('vaut 20 sans configuration', async () => {
    const { prisma } = await listOf({});
    expect(takeOf(prisma)).toBe(20);
  });

  it('suit `perPage`', async () => {
    const { prisma } = await listOf({ perPage: 5 });
    expect(takeOf(prisma)).toBe(5);
  });

  it('refuse au démarrage une taille nulle', () => {
    expect(() => build({ perPage: 0 })).toThrow(/perPage/);
  });

  it('refuse au démarrage une taille non entière', () => {
    expect(() => build({ perPage: 2.5 })).toThrow(/perPage/);
  });

  it('refuse au démarrage une taille au-delà du plafond', () => {
    expect(() => build({ perPage: 5000 })).toThrow(/perPage/);
  });

  it('refuse au démarrage une option invalide', () => {
    expect(() => build({ pageSizeOptions: [10, 0] })).toThrow(/pageSizeOptions/);
  });
});

describe('taille de page demandée par l’URL', () => {
  it('accepte une taille proposée', async () => {
    const { prisma } = await listOf({}, '/admin/user?perPage=50');
    expect(takeOf(prisma)).toBe(50);
  });

  it('refuse une taille non proposée et garde la configurée', async () => {
    // Sans ce refus, `?perPage=100000` est un `take` non borné.
    const { prisma } = await listOf({}, '/admin/user?perPage=100000');
    expect(takeOf(prisma)).toBe(20);
  });

  it('n’accepte rien quand le sélecteur est désactivé', async () => {
    const { prisma } = await listOf({ pageSizeOptions: [] }, '/admin/user?perPage=50');
    expect(takeOf(prisma)).toBe(20);
  });
});

describe('sélecteur de taille', () => {
  it('propose chaque taille en lien', async () => {
    const { html } = await listOf({});
    expect(html).toContain('href="/admin/user?perPage=50"');
    expect(html).toContain('href="/admin/user?perPage=100"');
  });

  it('marque la taille active sans en faire un lien', async () => {
    const { html } = await listOf({});
    expect(html).toMatch(/aria-current="true"[^>]*>20</);
    expect(html).not.toContain('href="/admin/user?perPage=20"');
  });

  it('revient à la première page en changeant de taille', async () => {
    const { html } = await listOf({}, '/admin/user?page=3');
    expect(html).not.toContain('page=3&amp;perPage=50');
  });

  it('ne rend aucun sélecteur quand les options sont vides', async () => {
    // Assertion sur le libellé et non sur la classe : la feuille de style est
    // inline dans chaque page, donc `ska-pagination__sizes` y figure toujours.
    const { html } = await listOf({ pageSizeOptions: [] });
    expect(html).not.toContain('>Rows</span>');
  });
});
