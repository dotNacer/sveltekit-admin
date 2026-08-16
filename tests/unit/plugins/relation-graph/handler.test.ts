import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler as createCoreHandler } from '../../../../src/lib/server/handler.js';
import { createAdminHandler as createPrismaHandler } from '../../../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';
import { createEvent } from '../../../fixtures/events.js';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';

afterEach(() => vi.restoreAllMocks());

const USER = { id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', name: 'Ada' };
const POST = { id: 'p1', title: 'Hello', authorId: 1, content: 'x' };

function core(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({ user: [USER], post: [POST] }),
  pluginOpts?: { models?: string[]; depth?: number }
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return {
    handler: createCoreHandler({
      adapter,
      plugins: [relationGraphPlugin(pluginOpts)],
      ...config
    } as any),
    prisma
  };
}

async function html(handler: any, url: string, extra?: Parameters<typeof createEvent>[0]) {
  const { event, resolve } = createEvent({ url, ...extra });
  const res = await handler({ event, resolve } as any);
  return { res, text: await res.text() };
}

describe('relationGraphPlugin via createAdminHandler', () => {
  it('GET /admin/user/1/graph renders Layout + SVG, not JSON', async () => {
    const { handler } = core();
    const { res, text } = await html(handler, '/admin/user/1/graph');
    expect(res.status).toBe(200);
    expect(text).toContain('ska-layout');
    expect(text).toContain('ska-rg');
    expect(text).toContain('User · Ada');
    expect(text).toContain('<svg');
    expect(text).toContain('ska-rg-viewport');
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    expect(text.trim().startsWith('{')).toBe(false);
  });

  it('does not inject graph CSS/JS on list/edit/dashboard', async () => {
    const { handler } = core();
    for (const url of ['/admin', '/admin/user', '/admin/user/1']) {
      const { text } = await html(handler, url);
      expect(text).not.toContain('ska-rg-viewport');
      expect(text).not.toContain('.ska-rg{');
    }
  });

  it('list + edit User show Graph before Edit', async () => {
    const { handler } = core({}, undefined, { models: ['User'] });
    const list = await html(handler, '/admin/user');
    expect(list.text).toContain('href="/admin/user/1/graph"');
    expect(list.text.indexOf('href="/admin/user/1/graph"')).toBeLessThan(list.text.indexOf('>Edit</a>'));
    const edit = await html(handler, '/admin/user/1');
    expect(edit.text).toContain('ska-record-actions');
    expect(edit.text).toContain('href="/admin/user/1/graph"');
    expect(edit.text.indexOf('href="/admin/user/1/graph"')).toBeLessThan(
      edit.text.indexOf('<form method="POST"')
    );
  });

  it('create User has no Graph action', async () => {
    const { handler } = core({}, undefined, { models: ['User'] });
    const { text } = await html(handler, '/admin/user/new');
    expect(text).not.toContain('ska-record-actions');
    expect(text).not.toContain('/graph');
  });

  it('POST /admin/user/1/graph is 405', async () => {
    const { handler, prisma } = core();
    const { event, resolve } = createEvent({
      url: '/admin/user/1/graph',
      body: { _action: 'delete', id: '1' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(prisma.calls.filter((c) => c.method === 'delete')).toHaveLength(0);
  });

  it('listWhere miss -> NotFound without ska-rg', async () => {
    const { handler } = core({
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toMatch(/User with ID "1" not found/);
    expect(text).not.toContain('ska-rg');
  });

  it('createAdminHandler({ prisma, plugins }) serves the page', async () => {
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const handler = createPrismaHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      plugins: [relationGraphPlugin({ models: ['User'] })]
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-rg');
  });

  it('createAdminHandler({ adapter, plugins }) serves the page', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-rg');
  });
});
