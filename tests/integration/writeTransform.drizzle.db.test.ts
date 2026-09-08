import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminHandler, createDrizzleAdapter } from '../../src/lib/server/adapters/drizzle/index.js';
import * as schema from '../fixtures/drizzle/schema.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Parité Prisma/Drizzle du write-transform hook (issue #25). `handleMutation`
 * est ORM-agnostic (`mutations.ts` n'importe aucun adapter), donc la seule
 * vraie preuve de parité est un test bout-en-bout côté Drizzle équivalent à
 * `tests/unit/writeTransform.test.ts` côté Prisma — même hook, même config,
 * sur un vrai adapter et une vraie base SQLite.
 */

const ERROR_ALERT = 'class="ska-alert ska-alert--error">Error:';

const sqlite = new Database(':memory:');
const db = drizzle(sqlite);

const call = (
  currentHandler: ReturnType<typeof createAdminHandler>,
  url: string,
  body?: Record<string, string>
) => {
  const { event, resolve } = createEvent({ url, body });
  return currentHandler({ event, resolve });
};

beforeAll(() => {
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT,
      password_hash TEXT,
      tenant_id INTEGER NOT NULL,
      created_at INTEGER
    );
  `);
});

beforeEach(() => {
  sqlite.exec('DELETE FROM users;');
});

afterAll(() => {
  sqlite.close();
});

describe('write-transform hook sur Drizzle (parité avec Prisma)', () => {
  it('transforme une valeur synchrone avant écriture (create)', async () => {
    const handler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      authCheck: () => true,
      models: {
        users: { transform: { passwordHash: (raw: unknown) => `hashed:${raw}` } }
      }
    });

    const res = await call(handler, '/admin/users/new', {
      _action: 'create',
      email: 'a@x.y',
      passwordHash: 'plain123',
      tenantId: '1'
    });

    expect(res.status).toBe(303);
    expect(
      sqlite.prepare('SELECT password_hash AS h FROM users WHERE email = ?').get('a@x.y')
    ).toEqual({ h: 'hashed:plain123' });
  });

  it('attend un transform async avant l’écriture', async () => {
    const handler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      authCheck: () => true,
      models: {
        users: {
          transform: {
            passwordHash: async (raw: unknown) => {
              await new Promise((resolve) => setTimeout(resolve, 1));
              return `async:${raw}`;
            }
          }
        }
      }
    });

    const res = await call(handler, '/admin/users/new', {
      _action: 'create',
      email: 'b@x.y',
      passwordHash: 'plain123',
      tenantId: '1'
    });

    expect(res.status).toBe(303);
    expect(
      sqlite.prepare('SELECT password_hash AS h FROM users WHERE email = ?').get('b@x.y')
    ).toEqual({ h: 'async:plain123' });
  });

  it('un throw dans le transform devient une erreur de validation, jamais une 500 brute', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      authCheck: () => true,
      models: {
        users: {
          transform: {
            passwordHash: () => {
              throw new Error('too weak');
            }
          }
        }
      }
    });

    const html = await (
      await call(handler, '/admin/users/new', {
        _action: 'create',
        email: 'c@x.y',
        passwordHash: 'weak',
        tenantId: '1'
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('passwordHash: too weak');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });

  it('ignore un transform configuré sur la colonne de scope (tenantId)', async () => {
    const tenantTransform = vi.fn((raw: unknown) => (raw as number) + 999);
    const handler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      authCheck: () => true,
      models: {
        users: {
          scope: () => ({ tenantId: 1 }),
          transform: { tenantId: tenantTransform }
        }
      }
    });

    const res = await call(handler, '/admin/users/new', {
      _action: 'create',
      email: 'd@x.y',
      tenantId: ''
    });

    expect(res.status).toBe(303);
    expect(tenantTransform).not.toHaveBeenCalled();
    expect(
      sqlite.prepare('SELECT tenant_id AS t FROM users WHERE email = ?').get('d@x.y')
    ).toEqual({ t: 1 });
  });
});
