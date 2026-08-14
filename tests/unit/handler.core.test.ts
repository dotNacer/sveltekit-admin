import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

afterEach(() => vi.restoreAllMocks());

describe('createAdminHandler — core', () => {
  it('lève une erreur si `adapter` est absent', () => {
    expect(() => createAdminHandler({} as any)).toThrow(
      /createAdminHandler requires `adapter`/
    );
  });

  it('ignore un `prisma` fourni sans adapter (toujours throw adapter)', () => {
    expect(() =>
      createAdminHandler({ prisma: createPrismaMock({}), prismaSchemaPath: FULL_SCHEMA_PATH } as any)
    ).toThrow(/createAdminHandler requires `adapter`/);
  });

  it('accepte un adapter seul, sans prisma', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });
});
