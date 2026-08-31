import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminHandler, createDrizzleAdapter } from '../../src/lib/server/adapters/drizzle/index.js';
import * as schema from '../fixtures/drizzle/schema.js';
import { createEvent } from '../fixtures/events.js';

const ERROR_ALERT = 'class="ska-alert ska-alert--error">Error:';

const sqlite = new Database(':memory:');
const db = drizzle(sqlite);
const handler = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: () => true
});

const callWith = (
  currentHandler: typeof handler,
  url: string,
  body?: Record<string, string>
) => {
  const { event, resolve } = createEvent({ url, body });
  return currentHandler({ event, resolve });
};

const call = (url: string, body?: Record<string, string>) => callWith(handler, url, body);

const insertUser = (email: string, tenantId: number, name: string | null = null): number => {
  const result = sqlite
    .prepare('INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)')
    .run(email, name, tenantId);
  return Number(result.lastInsertRowid);
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
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE posts_to_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id)
    );
  `);
});

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM posts_to_tags;
    DELETE FROM posts;
    DELETE FROM tags;
    DELETE FROM users;
  `);
});

afterAll(() => {
  sqlite.close();
});

describe('admin handler with a real Drizzle SQLite database', () => {
  it('shows the Drizzle models on the dashboard', async () => {
    const html = await (await call('/admin')).text();

    expect(html).toContain('Users');
    expect(html).toContain('Posts');
  });

  it('creates a user from a form submission', async () => {
    const response = await call('/admin/users/new', {
      _action: 'create',
      email: 'a@x.y',
      name: 'Ada',
      tenantId: '1'
    });

    expect(response.status).toBe(303);
    expect(
      sqlite.prepare('SELECT email, name, tenant_id AS tenantId FROM users').get()
    ).toEqual({
      email: 'a@x.y',
      name: 'Ada',
      tenantId: 1
    });
  });

  it('lists rows stored in SQLite', async () => {
    insertUser('a@x.y', 1, 'Ada');

    const html = await (await call('/admin/users')).text();

    expect(html).toContain('Ada');
  });

  it('updates and deletes a user by integer id', async () => {
    const userId = insertUser('before@x.y', 1, 'Before');

    const updateResponse = await call(`/admin/users/${userId}`, {
      _action: 'update',
      email: 'after@x.y',
      name: 'After',
      tenantId: '1'
    });

    expect(updateResponse.status).toBe(303);
    expect(sqlite.prepare('SELECT email, name FROM users WHERE id = ?').get(userId)).toEqual({
      email: 'after@x.y',
      name: 'After'
    });

    const deleteResponse = await call(`/admin/users/${userId}`, { _action: 'delete' });

    expect(deleteResponse.status).toBe(303);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });

  it('creates a post with an existing author and rejects a missing author', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');

    const response = await call('/admin/posts/new', {
      _action: 'create',
      title: 'Valid post',
      authorId: String(authorId)
    });

    expect(response.status).toBe(303);
    expect(sqlite.prepare('SELECT title, author_id AS authorId FROM posts').get()).toEqual({
      title: 'Valid post',
      authorId
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (
      await call('/admin/posts/new', {
        _action: 'create',
        title: 'Forged post',
        authorId: '9999'
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('invalid value');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts').get()).toEqual({ count: 1 });
  });

  it('rejects an author outside the configured relation scope', async () => {
    insertUser('allowed@x.y', 1, 'Allowed');
    const forbiddenId = insertUser('forbidden@x.y', 2, 'Forbidden');
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        posts: {
          relations: {
            author: { where: () => ({ tenantId: 1 }) }
          }
        }
      },
      authCheck: () => true
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (
      await callWith(scopedHandler, '/admin/posts/new', {
        _action: 'create',
        title: 'Out-of-scope post',
        authorId: String(forbiddenId)
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('invalid value');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts').get()).toEqual({ count: 0 });
  });

  it('sets and replaces a post many-to-many tag selection', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');
    const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
    const firstTagId = Number(insertTag.run('first').lastInsertRowid);
    const secondTagId = Number(insertTag.run('second').lastInsertRowid);
    const replacementTagId = Number(insertTag.run('replacement').lastInsertRowid);

    const createResponse = await call('/admin/posts/new', {
      _action: 'create',
      title: 'Tagged post',
      authorId: String(authorId),
      __rel_present__tags: '1',
      __rel__tags: `${firstTagId},${secondTagId}`
    });

    expect(createResponse.status).toBe(303);
    const post = sqlite.prepare('SELECT id FROM posts WHERE title = ?').get('Tagged post') as {
      id: number;
    };
    expect(
      sqlite
        .prepare('SELECT tag_id AS tagId FROM posts_to_tags WHERE post_id = ? ORDER BY tag_id')
        .all(post.id)
    ).toEqual([{ tagId: firstTagId }, { tagId: secondTagId }]);

    const updateResponse = await call(`/admin/posts/${post.id}`, {
      _action: 'update',
      title: 'Tagged post',
      authorId: String(authorId),
      __rel_present__tags: '1',
      __rel__tags: String(replacementTagId)
    });

    expect(updateResponse.status).toBe(303);
    expect(
      sqlite
        .prepare('SELECT tag_id AS tagId FROM posts_to_tags WHERE post_id = ?')
        .all(post.id)
    ).toEqual([{ tagId: replacementTagId }]);
  });

  it('rejects many-to-many ids outside the configured relation scope', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');
    const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
    const allowedTagId = Number(insertTag.run('js').lastInsertRowid);
    const forbiddenTagId = Number(insertTag.run('css').lastInsertRowid);
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        posts: {
          relations: {
            tags: { where: () => ({ name: 'js' }) }
          }
        }
      },
      authCheck: () => true
    });

    const createResponse = await callWith(scopedHandler, '/admin/posts/new', {
      _action: 'create',
      title: 'Scoped tags',
      authorId: String(authorId),
      __rel_present__tags: '1',
      __rel__tags: String(allowedTagId)
    });
    expect(createResponse.status).toBe(303);

    const post = sqlite.prepare('SELECT id FROM posts WHERE title = ?').get('Scoped tags') as {
      id: number;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (
      await callWith(scopedHandler, `/admin/posts/${post.id}`, {
        _action: 'update',
        title: 'Scoped tags',
        authorId: String(authorId),
        __rel_present__tags: '1',
        __rel__tags: `${allowedTagId},${forbiddenTagId}`
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('invalid value');
    expect(
      sqlite
        .prepare('SELECT tag_id AS tagId FROM posts_to_tags WHERE post_id = ? ORDER BY tag_id')
        .all(post.id)
    ).toEqual([{ tagId: allowedTagId }]);
  });

  it('fails closed on an opaque many-to-many scope during create', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');
    const tagId = Number(
      sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('forged').lastInsertRowid
    );
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        posts: {
          relations: {
            tags: { where: () => ({ author: { is: { tenantId: 1 } } }) }
          }
        }
      },
      authCheck: () => true
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (
      await callWith(scopedHandler, '/admin/posts/new', {
        _action: 'create',
        title: 'Rejected opaque scope',
        authorId: String(authorId),
        __rel_present__tags: '1',
        __rel__tags: String(tagId)
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('invalid value');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts_to_tags').get()).toEqual({
      count: 0
    });
  });

  it('fails closed on an opaque many-to-many scope during update', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');
    const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
    const existingTagId = Number(insertTag.run('existing').lastInsertRowid);
    const forgedTagId = Number(insertTag.run('forged').lastInsertRowid);
    const postId = Number(
      sqlite
        .prepare('INSERT INTO posts (title, author_id) VALUES (?, ?)')
        .run('Existing post', authorId).lastInsertRowid
    );
    sqlite
      .prepare('INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)')
      .run(postId, existingTagId);
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        posts: {
          relations: {
            tags: { where: () => ({ author: { is: { tenantId: 1 } } }) }
          }
        }
      },
      authCheck: () => true
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (
      await callWith(scopedHandler, `/admin/posts/${postId}`, {
        _action: 'update',
        title: 'Rejected update',
        authorId: String(authorId),
        __rel_present__tags: '1',
        __rel__tags: String(forgedTagId)
      })
    ).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('invalid value');
    expect(sqlite.prepare('SELECT title FROM posts WHERE id = ?').get(postId)).toEqual({
      title: 'Existing post'
    });
    expect(
      sqlite.prepare('SELECT tag_id AS tagId FROM posts_to_tags WHERE post_id = ?').all(postId)
    ).toEqual([{ tagId: existingTagId }]);
  });

  it('searches Drizzle relation options without a configured scope', async () => {
    const authorId = insertUser('ada@x.y', 1, 'Ada');
    insertUser('grace@x.y', 1, 'Grace');

    const response = await call('/admin/_search?rel=posts.author&q=Ada');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 1,
      options: [{ id: authorId, label: 'Ada' }]
    });
  });

  it('deletes pivot rows before deleting a post', async () => {
    const authorId = insertUser('author@x.y', 1, 'Author');
    const tagId = Number(
      sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('linked').lastInsertRowid
    );
    const createResponse = await call('/admin/posts/new', {
      _action: 'create',
      title: 'Delete with links',
      authorId: String(authorId),
      __rel_present__tags: '1',
      __rel__tags: String(tagId)
    });
    expect(createResponse.status).toBe(303);

    const post = sqlite.prepare('SELECT id FROM posts WHERE title = ?').get('Delete with links') as {
      id: number;
    };
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts_to_tags').get()).toEqual({ count: 1 });

    const deleteResponse = await call(`/admin/posts/${post.id}`, { _action: 'delete' });

    expect(deleteResponse.status).toBe(303);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM posts_to_tags').get()).toEqual({ count: 0 });
  });

  it('applies a flat listWhere scope', async () => {
    insertUser('visible@x.y', 1, 'Visible tenant');
    insertUser('hidden@x.y', 2, 'Hidden tenant');
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        users: { listWhere: () => ({ tenantId: 1 }) }
      },
      authCheck: () => true
    });

    const html = await (await callWith(scopedHandler, '/admin/users')).text();

    expect(html).toContain('Visible tenant');
    expect(html).not.toContain('Hidden tenant');
  });

  it('renders an error instead of failing open for a nested listWhere scope', async () => {
    const tenantOneAuthorId = insertUser('one@x.y', 1, 'Tenant one');
    const tenantTwoAuthorId = insertUser('two@x.y', 2, 'Tenant two');
    sqlite
      .prepare('INSERT INTO posts (title, author_id) VALUES (?, ?), (?, ?)')
      .run('Tenant one post', tenantOneAuthorId, 'Tenant two post', tenantTwoAuthorId);
    const scopedHandler = createAdminHandler({
      adapter: createDrizzleAdapter({ db, schema }),
      models: {
        posts: { listWhere: () => ({ author: { is: { tenantId: 1 } } }) }
      },
      authCheck: () => true
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (await callWith(scopedHandler, '/admin/posts')).text();
    error.mockRestore();

    expect(html).toContain(ERROR_ALERT);
    expect(html).not.toContain('Tenant one post');
    expect(html).not.toContain('Tenant two post');
  });
});

describe('parité du chemin d’écriture sensible avec Prisma', () => {
  it('n’affiche pas la colonne sensible dans le formulaire d’édition', async () => {
    sqlite
      .prepare('INSERT INTO users (email, name, password_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('p@x.y', 'P', '$2b$10$hash-drizzle', 1);
    const id = (sqlite.prepare('SELECT id FROM users WHERE email = ?').get('p@x.y') as any).id;

    const html = await (await call(`/admin/users/${id}`)).text();

    expect(html).not.toContain('$2b$10$hash-drizzle');
    expect(html).not.toContain('name="passwordHash"');
  });

  it('laisse la colonne sensible intacte sur un update', async () => {
    sqlite
      .prepare('INSERT INTO users (email, name, password_hash, tenant_id) VALUES (?, ?, ?, ?)')
      .run('q@x.y', 'Q', '$2b$10$intact', 1);
    const id = (sqlite.prepare('SELECT id FROM users WHERE email = ?').get('q@x.y') as any).id;

    // Le POST forge la colonne : elle n'est plus dans le formulaire, donc rien
    // de légitime ne l'envoie — et elle ne doit pas être écrite.
    const res = await call(`/admin/users/${id}`, {
      _action: 'update',
      email: 'q2@x.y',
      name: 'Q2',
      passwordHash: 'ecrase-moi',
      tenantId: '1'
    });
    expect(res.status).toBe(303);

    const row = sqlite
      .prepare('SELECT email, password_hash AS h FROM users WHERE id = ?')
      .get(id) as any;
    expect(row).toMatchObject({ email: 'q2@x.y', h: '$2b$10$intact' });
  });
});

