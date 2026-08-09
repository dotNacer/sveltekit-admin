import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const users = [
  { id: 1, email: 'alice@example.test', name: 'Alice', tenantId: 'tenant-a' },
  { id: 2, email: 'mallory@example.test', name: 'Mallory Secret', tenantId: 'tenant-b' },
  { id: 3, email: 'bob@example.test', name: 'Bob', tenantId: 'tenant-a' }
];
const posts = [
  { id: 'post-a', title: 'Tenant A post', authorId: 1, reviewerId: null },
  { id: 'post-b', title: 'Tenant B post', authorId: 2, reviewerId: null },
  { id: 'post-c', title: 'Second Tenant A post', authorId: 3, reviewerId: null }
];

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    user: users,
    post: posts,
    tag: [], label: [], profile: [], follow: [], order: [], line: [], auditLog: [], category: [], comment: [],
    ...overrides
  };
}

function handler(prisma: any, extra: Record<string, unknown> = {}) {
  return createAdminHandler({
    prisma,
    prismaSchemaPath: RELATIONS_SCHEMA_PATH,
    models: {
      Post: {
        listFilter: ['authorId'],
        relations: {
          author: {
            // Deliberate tenant scope used by every FK-filter test below.
            // The UI must apply it to options AND active-label resolution.
            where: ({ locals }: any) => ({ tenantId: locals.tenantId }),
            orderBy: { name: 'asc' }
          }
        }
      }
    },
    ...extra
  } as any);
}

function tenantEvent(url: string, tenantId = 'tenant-a') {
  return createEvent({ url, locals: { tenantId } });
}

describe('PR3 — FK list filter: options and cardinality', () => {
  it('loads FK options with the relation scope and renders scoped labels as links', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post');
    const html = await (await h({ event, resolve } as any)).text();

    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: { tenantId: 'tenant-a' } });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({
      where: { tenantId: 'tenant-a' }, orderBy: { name: 'asc' }
    });
    expect(html).toContain('href="/admin/post?f.authorId=1"');
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
    expect(html).not.toContain('Mallory Secret');
  });

  it('at linkThreshold exactly: renders links (not a select)', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { listFilterDefaults: { linkThreshold: 2 } });
    const { event, resolve } = tenantEvent('/admin/post');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('href="/admin/post?f.authorId=1"');
    expect(html).not.toContain('<select name="f.authorId"');
  });

  it('above linkThreshold but at selectThreshold: renders a select with an explicit Apply button', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { listFilterDefaults: { linkThreshold: 1 } });
    const { event, resolve } = tenantEvent('/admin/post');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('<select name="f.authorId"');
    expect(html).toContain('<option value="1">Alice</option>');
    expect(html).toContain('>Apply</button>');
  });

  it('above selectThreshold: falls back to a raw ID form and never loads options', async () => {
    const prisma = createPrismaMock(baseData(), { user: { count: () => 201 } });
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('type="text" name="f.authorId"');
    expect(html).not.toContain('href="/admin/post?f.authorId=1"');
    expect(callsTo(prisma, 'user', 'findMany')).toHaveLength(0);
  });

  it('count failure also falls back safely to raw ID instead of failing the list page', async () => {
    const prisma = createPrismaMock(baseData(), { user: { count: () => { throw new Error('db unavailable'); } } });
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post');
    const response = await h({ event, resolve } as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('type="text" name="f.authorId"');
  });
});

describe('PR3 — FK list filter: active chip and IDOR doctrine', () => {
  it('a scoped active FK value resolves to a readable label and a target-record link', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=1');
    const html = await (await h({ event, resolve } as any)).text();

    expect(html).toContain('Alice');
    expect(html).toContain('href="/admin/user/1"');
    expect(html).toContain('aria-label="Clear author Id"');
    expect(callsTo(prisma, 'user', 'findFirst')[0].args).toEqual({
      where: { AND: [{ id: 1 }, { tenantId: 'tenant-a' }] }
    });
  });

  it('IDOR oracle regression: forged FK ID outside scope shows the raw ID, never the secret label', async () => {
    // The critical §6.3.b test: user #2 EXISTS and would be found by an
    // unscoped findFirst, but it belongs to another tenant. The active chip
    // must show only "2" — NEVER "Mallory Secret" — and the query itself
    // must contain the AND with the configured relation scope.
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=2');
    const html = await (await h({ event, resolve } as any)).text();

    expect(html).toContain('>2</span>');
    expect(html).not.toContain('Mallory Secret');
    expect(html).not.toContain('href="/admin/user/2"');
    expect(callsTo(prisma, 'user', 'findFirst')[0].args).toEqual({
      where: { AND: [{ id: 2 }, { tenantId: 'tenant-a' }] }
    });
  });

  it('a target model excluded from the admin keeps the readable chip but removes the dead record link', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma, { exclude: ['User'] });
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=1');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Alice');
    expect(html).not.toContain('href="/admin/user/1"');
  });

  it('without a configured relation scope, active-label lookup uses the scalar PK condition directly', async () => {
    const prisma = createPrismaMock(baseData());
    // Explicit FK filter remains valid without a relation `where`; this is
    // the common single-tenant case. The findFirst must not manufacture an
    // empty AND array, it simply looks up the target PK.
    const h = handler(prisma, { models: { Post: { listFilter: ['authorId'] } } });
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=1');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Alice');
    expect(callsTo(prisma, 'user', 'findFirst')[0].args).toEqual({ where: { id: 1 } });
  });

  it('the active FK value filters the list by the scalar column, never by a relation traversal', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=1');
    await h({ event, resolve } as any);
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({ where: { authorId: 1 } });
  });

  it('active-label lookup failure degrades to the raw ID, never a 500', async () => {
    const prisma = createPrismaMock(baseData(), {
      user: { findFirst: () => { throw new Error('transient failure'); } }
    });
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=1');
    const response = await h({ event, resolve } as any);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('>1</span>');
    expect(html).not.toContain('href="/admin/user/1"');
  });
});
