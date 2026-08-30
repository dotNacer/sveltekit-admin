import { describe, it, expect, vi } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const USERS = [{ id: 1, email: 'a@b.c', password: 'x' }];

function build(config: Record<string, unknown> = {}) {
  const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
  return {
    handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any),
    prisma
  };
}

describe('vérification d’origine sur les requêtes mutantes', () => {
  it('rejette un POST dont l’Origin est une autre origine', async () => {
    const { handler, prisma } = build();
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://evil.example'
    });

    const res = await handler(ev as any);

    expect(res.status).toBe(403);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('rejette un POST sans en-tête Origin', async () => {
    const { handler, prisma } = build();
    const ev = createEvent({ url: '/admin/user/1', body: { _action: 'delete' }, origin: null });

    const res = await handler(ev as any);

    expect(res.status).toBe(403);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('ne renvoie ni l’origine reçue ni la liste attendue dans le corps du 403', async () => {
    const { handler } = build({ csrf: { trustedOrigins: ['https://ops.example'] } });
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://evil.example'
    });

    const body = await (await handler(ev as any)).text();

    expect(body).not.toContain('evil.example');
    expect(body).not.toContain('ops.example');
    expect(body).toContain('sveltekit-admin');
  });

  it('laisse passer un POST same-origin', async () => {
    const { handler } = build();
    const ev = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });

    expect((await handler(ev as any)).status).toBe(303);
  });

  it('n’inspecte pas les GET, même annoncés depuis une autre origine', async () => {
    const { handler } = build();
    const ev = createEvent({ url: '/admin/user', origin: 'https://evil.example' });

    expect((await handler(ev as any)).status).toBe(200);
  });

  it('rejette un POST cross-origin sur le logout avant d’exécuter le callback', async () => {
    const logout = vi.fn();
    const { handler } = build({ logout });
    const ev = createEvent({
      url: '/admin/_logout',
      body: {},
      origin: 'https://evil.example'
    });

    expect((await handler(ev as any)).status).toBe(403);
    expect(logout).not.toHaveBeenCalled();
  });

  it('rejette un POST cross-origin sur _search', async () => {
    const { handler } = build();
    const ev = createEvent({
      url: '/admin/_search?model=User&q=a',
      body: {},
      origin: 'https://evil.example'
    });

    expect((await handler(ev as any)).status).toBe(403);
  });

  it('rejette une méthode mutante autre que POST', async () => {
    const { handler } = build();
    const ev = createEvent({
      url: '/admin/user/1',
      method: 'DELETE',
      origin: 'https://evil.example'
    });

    expect((await handler(ev as any)).status).toBe(403);
  });

  it('ne touche pas aux requêtes hors basePath', async () => {
    const { handler } = build();
    const ev = createEvent({
      url: '/public',
      body: { anything: '1' },
      origin: 'https://evil.example'
    });

    const res = await handler(ev as any);

    expect(ev.resolve.called).toBe(true);
    expect(await res.text()).toBe('resolved-by-sveltekit');
  });
});

describe('configuration csrf', () => {
  it('csrf: false désactive entièrement la vérification', async () => {
    const { handler } = build({ csrf: false });
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://evil.example'
    });

    expect((await handler(ev as any)).status).toBe(303);
  });

  it('csrf: {} sans trustedOrigins vérifie quand même', async () => {
    const { handler } = build({ csrf: {} });
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://evil.example'
    });

    expect((await handler(ev as any)).status).toBe(403);
  });

  it('accepte un POST venant d’une origine listée dans trustedOrigins', async () => {
    const { handler } = build({ csrf: { trustedOrigins: ['https://ops.example'] } });
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://ops.example'
    });

    expect((await handler(ev as any)).status).toBe(303);
  });

  it('normalise trustedOrigins : un slash final ne fait pas diverger l’entrée', async () => {
    const { handler } = build({ csrf: { trustedOrigins: ['https://ops.example/'] } });
    const ev = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' },
      origin: 'https://ops.example'
    });

    expect((await handler(ev as any)).status).toBe(303);
  });

  it('rejette au boot une entrée trustedOrigins qui n’est pas une URL', () => {
    expect(() => build({ csrf: { trustedOrigins: ['ops.example'] } })).toThrow(
      /trustedOrigins/
    );
  });

  it('rejette au boot un schéma sans origine réelle (origin "null")', () => {
    expect(() => build({ csrf: { trustedOrigins: ['file:///tmp'] } })).toThrow(
      /trustedOrigins/
    );
  });
});
