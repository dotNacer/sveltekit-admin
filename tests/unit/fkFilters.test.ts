import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, callsTo } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const users = [
  { id: 1, email: 'alice@example.test', name: 'Alice', tenantId: 'tenant-a' },
  { id: 2, email: 'mallory@example.test', name: 'Mallory Secret', tenantId: 'tenant-b' },
  { id: 3, email: 'bob@example.test', name: 'Bob', tenantId: 'tenant-a' }
];
const posts = [
  { id: 'post-a', title: 'Tenant A post', authorId: 1, reviewerId: null, tenantId: 'tenant-a' },
  { id: 'post-b', title: 'CONFIDENTIAL Tenant B post', authorId: 2, reviewerId: null, tenantId: 'tenant-b' },
  { id: 'post-c', title: 'Second Tenant A post', authorId: 3, reviewerId: null, tenantId: 'tenant-a' }
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

/**
 * Same as `handler`, but ALSO scopes the Post list itself by tenant — the
 * B1 fix found in review: without a model-level `listWhere`, the FK
 * filter's §6.3.b label protection was real but the LISTED ROWS were
 * never scoped, so `?f.authorId=<id-from-another-tenant>` would still
 * leak the target tenant's post title into the table even though its
 * author's name stayed hidden. This is the config a real multi-tenant
 * app must set for the FK filter to be actually safe end-to-end, not
 * just on the chip. Note it is a DIFFERENT function than
 * `relations[x].where` (the active-chip label scope) — the two must be
 * configured independently, see the dedicated test below for what
 * happens if only one of the two is set.
 */
function handlerWithListScope(prisma: any, extra: Record<string, unknown> = {}) {
  return createAdminHandler({
    prisma,
    prismaSchemaPath: RELATIONS_SCHEMA_PATH,
    models: {
      Post: {
        listFilter: ['authorId'],
        listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId }),
        relations: {
          author: {
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

describe('PR3 — FK list filter: cross-tenant row enumeration (B1, found in review)', () => {
  it('WITHOUT a model-level list scope, a forged FK filter leaks another tenant\'s row into the table', async () => {
    // Documents the pre-fix vulnerability precisely: the chip's label stays
    // protected (§6.3.b, already covered above), but the config in this
    // test (`handler`, no `models.Post.listWhere`) has no list-level scoping at
    // all, so the row itself is never protected either — by design, this
    // isn't a bug, it's what "no list scope configured" means. The point of
    // this test is to make the difference with `handlerWithListScope` below
    // explicit and regression-proof.
    const prisma = createPrismaMock(baseData());
    const h = handler(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=2');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('CONFIDENTIAL Tenant B post');
  });

  it('WITH a model-level list scope configured, the same forged FK filter returns an empty, safe list', async () => {
    // The B1 fix: `models.Post.listWhere` is threaded into buildWhere's scope
    // argument for the list view, composed via AND (never a spread) with
    // every active filter — including the FK filter. A tenant-a request for
    // `?f.authorId=2` (tenant-b's author) now yields zero rows: the FK
    // filter's `{authorId: 2}` clause intersects with `{tenantId: 'tenant-a'}`,
    // which no tenant-b row can ever satisfy.
    const prisma = createPrismaMock(baseData());
    const h = handlerWithListScope(prisma);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=2');
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('CONFIDENTIAL Tenant B post');
    expect(html).toContain('0 records');
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({
      where: { AND: [{ tenantId: 'tenant-a' }, { authorId: 2 }] }
    });
  });

  it('the list scope composes with search and non-FK filters too, always via AND, never a spread', async () => {
    const prisma = createPrismaMock(baseData());
    const h = handlerWithListScope(prisma, { models: { Post: {
      listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId }),
      searchFields: ['title'],
      listFilter: ['authorId'],
      relations: { author: { where: ({ locals }: any) => ({ tenantId: locals.tenantId }) } }
    } } });
    const { event, resolve } = tenantEvent('/admin/post?q=Second');
    await h({ event, resolve } as any);
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({
      where: { AND: [{ tenantId: 'tenant-a' }, { OR: [{ title: { contains: 'Second' } }] }] }
    });
  });

  it('a filter on the SAME field as the list scope never overwrites it (AND, not spread — the exact §0.c regression shape)', async () => {
    // Reuse `authorId` as the scoped field this time (it's a real scalar
    // column on Post, unlike `tenantId` which only exists in the test
    // fixture's row data — `?f.<field>=` requires a field that actually
    // exists on the model, per parseListQuery's whitelist).
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: {
        // Deliberately scope by the SAME field a filter can target.
        listWhere: () => ({ authorId: 1 }),
        listFilter: ['authorId']
      } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/post?f.authorId=2' });
    await h({ event, resolve } as any);
    // If this were a spread ({...scope, ...filter}), the result would be a
    // single flat { authorId: 2 } — the attacker's value winning outright.
    // With AND composition, both clauses survive as independent entries
    // and the (impossible) intersection empties the list instead.
    expect(callsTo(prisma, 'post', 'findMany')[0].args).toMatchObject({
      where: { AND: [{ authorId: 1 }, { authorId: 2 }] }
    });
  });

  it('a listWhere scope that returns {} fails loud instead of silently disabling protection (fail-open guard)', async () => {
    // Realistic trigger: a scope function derived from `locals.userId`
    // when the session has expired and `locals.userId` is undefined —
    // `{}` composed into an AND matches every row, the exact opposite of
    // what configuring listWhere is meant to do. Found in review (A9):
    // must throw, never silently degrade to "no scope".
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: { listWhere: () => ({}) } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/post' });
    const response = await h({ event, resolve } as any);
    // The handler's top-level try/catch turns the thrown error into a
    // rendered alert rather than an unhandled crash — but the query that
    // would have leaked every row must never actually execute unscoped.
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('listWhere returned an empty object');
    expect(callsTo(prisma, 'post', 'findMany')).toHaveLength(0);
  });

  it('listWhere alone does NOT protect the active FK chip label — relations[x].where must be set independently (A10)', async () => {
    // Documents a real gap found in review: listWhere scopes the LISTED
    // ROWS; the active-chip label is resolved through a completely
    // different function, relations[x].where. A developer who configures
    // only listWhere (believing "the model is scoped now") still gets a
    // chip that leaks another tenant's display name, even though the row
    // itself is correctly hidden from the table.
    const prisma = createPrismaMock(baseData());
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      models: { Post: {
        listFilter: ['authorId'],
        listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId })
        // Deliberately NOT setting relations.author.where here.
      } }
    } as any);
    const { event, resolve } = tenantEvent('/admin/post?f.authorId=2');
    const html = await (await h({ event, resolve } as any)).text();
    // The row itself: correctly protected by listWhere.
    expect(html).not.toContain('CONFIDENTIAL Tenant B post');
    // The chip: NOT protected, because relations.author.where was never
    // configured. This is documented, expected-given-the-config behaviour
    // — the point of this test is to make the gap regression-visible, not
    // to claim it's fixed.
    expect(html).toContain('Mallory Secret');
  });
});
