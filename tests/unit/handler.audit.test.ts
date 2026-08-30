import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import {
  createPrismaMock,
  callsTo,
  FULL_SCHEMA_PATH,
  RELATIONS_SCHEMA_PATH
} from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

afterEach(() => vi.restoreAllMocks());

const userRow = { id: 1, email: 'a@b.c', password: 'secret', name: 'A', bio: 'old' };

function build(config: Record<string, unknown> = {}) {
  const prisma = createPrismaMock(
    { user: [{ ...userRow }], post: [], category: [] },
    {
      user: {
        create: (args: any) => ({ id: 99, ...(args as any).data }),
        update: (args: any) => ({ ...userRow, ...(args as any).data })
      }
    }
  );
  return {
    handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any),
    prisma
  };
}

function formEvent(url: string, fields: [string, string][], locals: Record<string, unknown> = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of fields) body.append(k, v);
  const url2 = new URL(url, 'http://localhost');
  const request = new Request(url2, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: url2.origin }
  });
  const resolve = Object.assign(async () => new Response('resolved'), { called: false });
  return { event: { url: url2, request, locals }, resolve };
}

describe('audit callback', () => {
  it('sans `audit` : create/update/delete 303, pas de snapshot findUnique extra', async () => {
    const { handler, prisma } = build();
    const create = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' }
    });
    expect((await handler({ event: create.event, resolve: create.resolve } as any)).status).toBe(303);

    const update = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'u@x.y' }
    });
    expect((await handler({ event: update.event, resolve: update.resolve } as any)).status).toBe(303);
    expect(callsTo(prisma, 'user', 'findUnique')).toHaveLength(0);

    const del = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    expect((await handler({ event: del.event, resolve: del.resolve } as any)).status).toBe(303);
    expect(callsTo(prisma, 'user', 'findUnique')).toHaveLength(0);
  });

  it('create : payload redacté, id retourné, même event.locals', async () => {
    const audit = vi.fn();
    const { handler } = build({ audit });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' },
      locals: { session: { user: { id: 7 } } }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('create');
    expect(entry.model).toBe('User');
    expect(entry.id).toBe(99);
    expect(entry.values.email).toBe('n@x.y');
    expect(entry.values.password).toBeUndefined();
    expect(entry.after.password).toBeUndefined();
    expect(entry.after.id).toBe(99);
    expect(entry.event).toBe(event);
    expect(entry.event.locals.session.user.id).toBe(7);
    expect(entry.at).toBeInstanceOf(Date);
  });

  it('update : before / changes / id coercé, snapshot findUnique une fois', async () => {
    const audit = vi.fn();
    const { handler, prisma } = build({ audit });
    const { event, resolve } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'u@x.y' }
    });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect(callsTo(prisma, 'user', 'findUnique')).toHaveLength(1);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('update');
    expect(entry.id).toBe(1);
    expect(entry.before.email).toBe('a@b.c');
    expect(entry.before.password).toBeUndefined();
    expect(entry.changes.email).toEqual({ from: 'a@b.c', to: 'u@x.y' });
    expect(entry.values.email).toBe('u@x.y');
  });

  it('delete : before redacté, pas de values', async () => {
    const audit = vi.fn();
    const { handler } = build({ audit });
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('delete');
    expect(entry.id).toBe(1);
    expect(entry.before).toEqual({ id: 1, email: 'a@b.c', name: 'A', bio: 'old' });
    expect(entry.values).toBeUndefined();
  });

  it('mutation qui throw : audit non appelé', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const audit = vi.fn();
    const prisma = createPrismaMock(
      { user: [{ ...userRow }], post: [], category: [] },
      { user: { create: () => { throw new Error('boom'); } } }
    );
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      audit
    } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('callback qui throw : 303 quand même, erreur journalisée', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('sink down');
    const audit = vi.fn(() => {
      throw err;
    });
    const { handler } = build({ audit });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(error).toHaveBeenCalledWith('[sveltekit-admin] audit callback failed:', err);
  });

  it('await le callback async avant de résoudre', async () => {
    const order: string[] = [];
    const audit = vi.fn(async () => {
      await Promise.resolve();
      order.push('audit-done');
    });
    const { handler } = build({ audit });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' }
    });
    await handler({ event, resolve } as any);
    order.push('after-handler');
    expect(order).toEqual(['audit-done', 'after-handler']);
  });

  it('update sans id : 303 sans écriture ni audit', async () => {
    const audit = vi.fn();
    const { handler, prisma } = build({ audit });
    const { event, resolve } = createEvent({
      url: '/admin/user',
      body: { _action: 'update', email: 'x@y.z' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(callsTo(prisma, 'user', 'update')).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('delete sans id : pas d’audit', async () => {
    const audit = vi.fn();
    const { handler, prisma } = build({ audit });
    const { event, resolve } = createEvent({ url: '/admin/user', body: { _action: 'delete' } });
    await handler({ event, resolve } as any);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it('GET : pas d’audit', async () => {
    const audit = vi.fn();
    const { handler } = build({ audit });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    await handler({ event, resolve } as any);
    expect(audit).not.toHaveBeenCalled();
  });

  it('hidden : bio absent des snapshots même s’il est soumis', async () => {
    const audit = vi.fn();
    const { handler } = build({ audit, models: { User: { hidden: ['bio'] } } });
    const { event, resolve } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'u@x.y', bio: 'nope' }
    });
    await handler({ event, resolve } as any);
    const entry = audit.mock.calls[0][0];
    expect(entry.values.bio).toBeUndefined();
    expect(entry.before.bio).toBeUndefined();
    expect(entry.after.bio).toBeUndefined();
    expect(entry.changes.bio).toBeUndefined();
  });

  it('snapshot illisible : mutation OK, before null, changes {}', async () => {
    const audit = vi.fn();
    const prisma = createPrismaMock(
      { user: [{ ...userRow }], post: [], category: [] },
      {
        user: {
          findUnique: () => {
            throw new Error('read fail');
          },
          update: (args: any) => ({ ...userRow, ...(args as any).data })
        }
      }
    );
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      audit
    } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'u@x.y' }
    });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    const entry = audit.mock.calls[0][0];
    expect(entry.before).toBeNull();
    expect(entry.changes).toEqual({});
    expect(entry.action).toBe('update');
  });

  it('create N-N : m2m.tags porte les ids soumis', async () => {
    const audit = vi.fn();
    const tags = [
      { id: 1, name: 'js' },
      { id: 2, name: 'ts' }
    ];
    const prisma = createPrismaMock(
      {
        user: [{ id: 1, email: 'alice@a.c' }],
        post: [],
        tag: tags,
        profile: [],
        follow: [],
        order: [],
        line: [],
        auditLog: [],
        category: [],
        comment: [],
        label: []
      },
      {
        post: {
          create: (args: any) => ({ id: 'new1', ...(args as any).data })
        }
      }
    );
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH,
      audit
    } as any);
    const { event, resolve } = formEvent('/admin/post/new', [
      ['_action', 'create'],
      ['title', 'T'],
      ['authorId', '1'],
      ['__rel_present__tags', '1'],
      ['__rel__tags', '1'],
      ['__rel__tags', '2']
    ]);
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('create');
    expect(entry.model).toBe('Post');
    expect(entry.m2m.tags).toEqual([1, 2]);
  });
});
