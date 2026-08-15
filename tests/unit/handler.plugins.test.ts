import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler as createCoreHandler } from '../../src/lib/server/handler.js';
import { createAdminHandler as createPrismaHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';
import { fakeGraphPlugin } from '../fixtures/fakeGraphPlugin.js';
import type { AdminPlugin } from '../../src/lib/server/plugin.js';

afterEach(() => vi.restoreAllMocks());

const USER = { id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', name: 'Ada' };
const POST = { id: 'p1', title: 'Hello', authorId: 1, content: 'x' };

function core(config: Record<string, unknown> = {}, prisma = createPrismaMock({ user: [USER], post: [POST] })) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return {
    handler: createCoreHandler({ adapter, plugins: [fakeGraphPlugin()], ...config } as any),
    prisma
  };
}

async function html(handler: any, url: string, extra?: Parameters<typeof createEvent>[0]) {
  const { event, resolve } = createEvent({ url, ...extra });
  const res = await handler({ event, resolve } as any);
  return { res, text: await res.text() };
}

describe('plugins omis', () => {
  it('GET /admin/user/1/graph → NotFound ; pas de script extra ni ska-record-actions', async () => {
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter });
    const graph = await html(handler, '/admin/user/1/graph');
    expect(graph.text).toContain('Page not found');
    expect(graph.text).not.toContain('ska-fake-graph');
    const list = await html(handler, '/admin/user');
    expect(list.text).not.toContain('ska-record-actions');
    expect(list.text).not.toContain('/admin/user/1/graph');
    expect(list.text).not.toContain('window.__skaFakeGraph');
  });
});

describe('page plugin fake-graph', () => {
  it('GET /admin/user/1/graph rend HTML + CSS/JS dans le Layout', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
    expect(text).toContain('a@b.c');
    expect(text).toContain('.ska-fake-graph{color:red}');
    expect(text).toContain('<script>window.__skaFakeGraph=1</script>');
    expect(text).toContain('href="/admin/user"');
  });

  it('n’injecte pas le JS/CSS plugin sur list/edit/dashboard', async () => {
    const { handler } = core();
    for (const url of ['/admin', '/admin/user', '/admin/user/1']) {
      const { text } = await html(handler, url);
      expect(text).not.toContain('window.__skaFakeGraph');
      expect(text).not.toContain('.ska-fake-graph{color:red}');
    }
  });

  it('GET /admin/post/1/graph → 404 et render non appelé', async () => {
    const render = vi.fn(async () => ({ html: 'SHOULD_NOT' }));
    const plugin: AdminPlugin = {
      name: 'fake-graph',
      pages: [{ pattern: [':model', ':id', 'graph'], models: ['User'], render }]
    };
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/post/p1/graph');
    expect(text).toContain('not found');
    expect(text).not.toContain('SHOULD_NOT');
    expect(render).not.toHaveBeenCalled();
  });

  it('listWhere hors scope → 404, render non appelé', async () => {
    const render = vi.fn(async () => ({ html: 'SHOULD_NOT' }));
    const plugin: AdminPlugin = {
      name: 'fake-graph',
      pages: [{ pattern: [':model', ':id', 'graph'], models: ['User'], render }]
    };
    const prisma = createPrismaMock({ user: [{ ...USER, tenantId: 1 }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({
      adapter,
      plugins: [plugin],
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toMatch(/User with ID "1" not found/);
    expect(render).not.toHaveBeenCalled();
  });

  it('hidden + password absents du HTML même si le plugin dump record', async () => {
    const { handler } = core({ models: { User: { hidden: ['bio'] } } });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('hidden-bio');
    expect(text).toContain('a@b.c');
  });

  it('render qui throw → alerte HTML du catch existant, pas d’assets plugin', async () => {
    const plugin: AdminPlugin = {
      name: 'boom',
      pages: [
        {
          pattern: [':model', ':id', 'graph'],
          models: ['User'],
          render: () => {
            throw new Error('kaboom <img>');
          }
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-alert ska-alert--error');
    expect(text).toContain('Error: kaboom &lt;img&gt;');
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('ska-fake-graph');
  });

  it('render sans styles/scripts → extraStyles/extraScripts vides', async () => {
    const plugin: AdminPlugin = {
      name: 'no-assets',
      pages: [{ pattern: [':model', ':id', 'graph'], models: ['User'], render: () => ({ html: 'PLAIN' }) }]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('PLAIN');
    expect(text).not.toContain('<script>');
  });

  it('POST /admin/user/1/graph → 405, pas de delete', async () => {
    const { handler, prisma } = core();
    const { event, resolve } = createEvent({
      url: '/admin/user/1/graph',
      body: { _action: 'delete' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('authCheck false → 401 sur la page plugin', async () => {
    const { handler } = core({ authCheck: () => false });
    const { res, text } = await html(handler, '/admin/user/1/graph');
    expect(res.status).toBe(401);
    expect(text).toBe('Unauthorized');
  });

  it('page [hello] sans :id', async () => {
    const plugin: AdminPlugin = {
      name: 'hello',
      pages: [
        {
          pattern: ['hello'],
          render: (ctx) => ({ html: `hello-ok:${ctx.record === undefined ? 'no-record' : 'record'}` })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/hello');
    expect(text).toContain('hello-ok:no-record');
  });

  it('page :model sans :id', async () => {
    const plugin: AdminPlugin = {
      name: 'stats',
      pages: [
        {
          pattern: [':model', 'stats'],
          render: (ctx) => ({ html: `stats:${ctx.route.model}:${ctx.record === undefined ? 'no' : 'yes'}` })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/user/stats');
    expect(text).toContain('stats:user:no');
  });

  it('overlap : premier plugin gagne', async () => {
    // 'user', '1' et 'graph' sont tous littéraux ici (pas de :id sans :model,
    // règle du pluginRegistry) — ce pattern est plus spécifique que celui de
    // `second` mais structurellement DIFFÉRENT (donc pas de collision détectée
    // à l'enregistrement) : les deux matchent `/admin/user/1/graph`, et l'ordre
    // d'enregistrement (donc l'ordre dans `registry.routes`) tranche.
    const first: AdminPlugin = {
      name: 'first',
      pages: [
        {
          pattern: ['user', '1', 'graph'],
          render: async () => ({ html: 'FROM_FIRST' })
        }
      ]
    };
    const second: AdminPlugin = {
      name: 'second',
      pages: [
        {
          pattern: [':model', ':id', 'graph'],
          render: async () => ({ html: 'FROM_SECOND' })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [first, second] });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('FROM_FIRST');
    expect(text).not.toContain('FROM_SECOND');
  });
});

describe('shadowing d’une vue builtin par un pattern littéral', () => {
  it("pattern ['user'] masque la liste User : GET sert le plugin, POST → 405 sans mutation", async () => {
    // Documente l'ordre de match actuel (plugins avant BUILTIN_ROUTES) — ce
    // n'est pas un bug à corriger ici, voir docs/plugins.svx "shadows".
    const plugin: AdminPlugin = {
      name: 'shadow-user-list',
      pages: [{ pattern: ['user'], render: () => ({ html: 'SHADOWED_LIST' }) }]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });

    const { text } = await html(handler, '/admin/user');
    expect(text).toContain('SHADOWED_LIST');
    expect(text).not.toContain('<table');

    const { event, resolve } = createEvent({
      url: '/admin/user',
      body: { _action: 'delete', id: '1' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });
});

describe('recordActions', () => {
  it('liste User : Graph avant Edit', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user');
    expect(text).toContain('href="/admin/user/1/graph"');
    const graphAt = text.indexOf('href="/admin/user/1/graph"');
    const editAt = text.indexOf('>Edit</a>');
    expect(graphAt).toBeGreaterThan(-1);
    expect(graphAt).toBeLessThan(editAt);
  });

  it('edit User : barre hors form POST', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1');
    expect(text).toContain('ska-record-actions');
    expect(text).toContain('href="/admin/user/1/graph"');
    const actionHref = text.indexOf('href="/admin/user/1/graph"');
    const formStart = text.indexOf('<form method="POST"');
    expect(actionHref).toBeLessThan(formStart);
  });

  it('create User : pas d’action plugin', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/new');
    expect(text).not.toContain('ska-record-actions');
    expect(text).not.toContain('/graph');
  });

  it('liste/edit Post : pas de lien Graph', async () => {
    const { handler } = core();
    const list = await html(handler, '/admin/post');
    expect(list.text).not.toContain('/graph');
    const edit = await html(handler, '/admin/post/p1');
    expect(edit.text).not.toContain('/graph');
  });

  it('échappe label et href XSS', async () => {
    const plugin: AdminPlugin = {
      name: 'xss',
      recordActions: [
        {
          label: '<img>',
          href: () => '/admin/user/1/graph" onclick="alert(1)'
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const list = await html(handler, '/admin/user');
    expect(list.text).toContain('&lt;img&gt;');
    expect(list.text).not.toMatch(/<td class="ska-table__actions">[^<]*<img>/);
    expect(list.text).toContain('onclick=&quot;alert(1)');
    const edit = await html(handler, '/admin/user/1');
    expect(edit.text).toContain('&lt;img&gt;');
    expect(edit.text).not.toContain('<img>');
  });
});

describe('wrapper prisma + adapter', () => {
  it('createAdminHandler({ prisma, plugins }) sert la page', async () => {
    const prisma = createPrismaMock({ user: [USER] });
    const handler = createPrismaHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      plugins: [fakeGraphPlugin()]
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
  });

  it('createAdminHandler({ adapter, plugins }) sert la page', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
  });
});
