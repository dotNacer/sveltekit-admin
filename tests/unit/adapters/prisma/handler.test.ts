import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';
import { createEvent } from '../../../fixtures/events.js';

afterEach(() => vi.restoreAllMocks());

describe('createAdminHandler — raccourci Prisma', () => {
  it('lève une erreur claire à la création si ni `prisma` ni `adapter` ne sont fournis', () => {
    expect(() => createAdminHandler({} as any)).toThrow(
      /createAdminHandler requires either `prisma`.*or `adapter`/
    );
  });

  it('avertit et rend un admin vide si le schéma est illisible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createAdminHandler({
      prisma: createPrismaMock({}),
      prismaSchemaPath: '/nope.prisma'
    });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(warn).toHaveBeenCalled();
    expect(html).not.toContain('href="/admin/user"');
    expect(html).toContain('<div class="ska-stat__value">0</div>');
  });

  it('avertit aussi quand aucun chemin de schéma n’est fourni', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createAdminHandler({ prisma: createPrismaMock({}) });
    const { event, resolve } = createEvent({ url: '/admin' });
    expect((await handler({ event, resolve } as any)).status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('accepte un adapter fourni directement, sans prismaSchemaPath', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });

  it("boot avec search.mode 'insensitive' reste synchrone et sert la liste", async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      search: { mode: 'insensitive' }
    });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });
});
