import { describe, it, expect, vi } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

/**
 * `logout` follows the exact same "bring your own auth" philosophy as
 * `authCheck` (docs/design intent, see handler.ts's JSDoc on the option):
 * the library has no session system of its own, so it can't clear one for
 * you — it only wires your side-effect function to a dedicated route and
 * renders a sidebar button when configured.
 */

function build(config: Record<string, unknown> = {}) {
  const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c', password: 'x' }], post: [], category: [] });
  return { handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any), prisma };
}

describe('logout route (/admin/_logout)', () => {
  it('POST calls the configured logout() and redirects to logoutRedirectTo (default "/")', async () => {
    const logout = vi.fn();
    const { handler } = build({ logout });
    const { event, resolve } = createEvent({ url: '/admin/_logout', body: {} });
    const res = await handler({ event, resolve } as any);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith(event);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });

  it('respects a configured logoutRedirectTo', async () => {
    const { handler } = build({ logout: vi.fn(), logoutRedirectTo: '/login' });
    const { event, resolve } = createEvent({ url: '/admin/_logout', body: {} });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('GET is rejected with 405 — logout must never be triggerable by a bare link/prefetch/crawler', async () => {
    const logout = vi.fn();
    const { handler } = build({ logout });
    const { event, resolve } = createEvent({ url: '/admin/_logout' });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    expect(logout).not.toHaveBeenCalled();
  });

  it('without a logout function configured, POST still redirects (no-op side effect, no crash)', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin/_logout', body: {} });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });

  it('runs BEFORE authCheck: a request that would otherwise 401 can still log out', async () => {
    const logout = vi.fn();
    const authCheck = vi.fn().mockResolvedValue(false);
    const { handler } = build({ logout, authCheck });
    const { event, resolve } = createEvent({ url: '/admin/_logout', body: {} });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(authCheck).not.toHaveBeenCalled();
  });

  it('async logout() is awaited before redirecting', async () => {
    const order: string[] = [];
    const logout = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 0));
      order.push('logout-done');
    });
    const { handler } = build({ logout });
    const { event, resolve } = createEvent({ url: '/admin/_logout', body: {} });
    await handler({ event, resolve } as any);
    order.push('after-handler');
    expect(order).toEqual(['logout-done', 'after-handler']);
  });

  it('respects a custom basePath', async () => {
    const logout = vi.fn();
    const { handler } = build({ logout, basePath: '/back' });
    const { event, resolve } = createEvent({ url: '/back/_logout', body: {} });
    const res = await handler({ event, resolve } as any);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
  });

  it('a request outside basePath is still passed through to resolve, unaffected by the logout route', async () => {
    const { handler } = build({ logout: vi.fn() });
    const { event, resolve } = createEvent({ url: '/public' });
    await handler({ event, resolve } as any);
    expect(resolve.called).toBe(true);
  });
});

describe('the sidebar logout button, wired end-to-end through the real handler', () => {
  it('is rendered when `logout` is configured', async () => {
    const { handler } = build({ logout: vi.fn() });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toMatch(/class="ska-logout__btn"/);
    expect(html).toContain('<form method="POST" action="/admin/_logout"');
  });

  it('is absent when `logout` is not configured — no behavioural change for existing users of the option', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).not.toMatch(/class="ska-logout__btn"/);
  });
});
