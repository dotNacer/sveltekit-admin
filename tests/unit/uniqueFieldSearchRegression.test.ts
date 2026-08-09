import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Regression: an earlier fix for B3 (Prisma rejecting `contains` on numeric
 * columns) over-generalized the "String field -> equals instead of contains"
 * rule from `@id` to `@id || @unique`. That broke fragment search on the
 * single most common real-world case in an admin panel: finding a user by
 * a partial email address. `User.email` is `String @unique` in nearly every
 * real Prisma schema and is exactly the "a title, an email" example the
 * design doc's §2.3 uses to justify free-text search existing at all.
 *
 * This suite locks the fix: `@unique` alone must never switch a field to
 * `equals` — only `@id` does.
 */

const users = [
  { id: 1, email: 'jean.dupont@corp.com', name: 'Jean Dupont', bio: null },
  { id: 2, email: 'marie@corp.com', name: 'Marie', bio: null }
];

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users, post: [], tag: [], profile: [], follow: [], order: [], line: [],
    auditLog: [], category: [], comment: [], label: [], ...overrides
  };
}

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH, ...config } as any);
}

describe('default search heuristic still finds a partial email match (regression on a @unique field)', () => {
  it('searching a fragment of an email address (default heuristic, no config) finds the row', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/user?q=dupont' });
    const html = await (await h({ event, resolve } as any)).text();

    const where = callsTo(prisma, 'user', 'findMany')[0].args as any;
    expect(JSON.stringify(where.where)).toContain('contains');
    expect(JSON.stringify(where.where)).not.toContain('"equals"');
    expect(html).toContain('jean.dupont@corp.com');
  });

  it('a fragment that only matches inside the email domain still finds the row', async () => {
    const prisma = createPrismaMock(baseData({
      user: [{ id: 3, email: 'contact@acme.io', name: null, bio: null }]
    }));
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/user?q=acme' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('1 records');
    expect(html).toContain('contact@acme.io');
  });

  it('email configured explicitly in searchFields also stays on contains, not equals', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { models: { User: { searchFields: ['email'] } } });
    const { event, resolve } = createEvent({ url: '/admin/user?q=marie' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('marie@corp.com');
    const where = callsTo(prisma, 'user', 'findMany')[0].args as any;
    expect(JSON.stringify(where.where)).toContain('contains');
  });
});
