import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Field, Model } from '../../src/lib/server/types/schema.js';
import {
  redactForAudit,
  diffRecords,
  buildAuditEvent,
  readAuditSnapshot,
  emitAudit,
  type AuditEvent
} from '../../src/lib/server/audit.js';

afterEach(() => vi.restoreAllMocks());

function field(over: Partial<Field> & Pick<Field, 'name' | 'type'>): Field {
  return {
    isRequired: true,
    isList: false,
    isUnique: false,
    isId: false,
    isUpdatedAt: false,
    isCreatedAt: false,
    hasDefault: false,
    ...over
  };
}

const User: Model = {
  name: 'User',
  fields: [
    field({ name: 'id', type: 'Int', isId: true }),
    field({ name: 'email', type: 'String', isUnique: true }),
    field({ name: 'password', type: 'String' }),
    field({ name: 'sessionToken', type: 'String', isRequired: false }),
    field({ name: 'bio', type: 'String', isRequired: false }),
    field({ name: 'metadata', type: 'Json', isRequired: false }),
    field({ name: 'visits', type: 'BigInt', isRequired: false }),
    field({ name: 'createdAt', type: 'DateTime', isCreatedAt: true, hasDefault: true }),
    field({
      name: 'posts',
      type: 'Post',
      isList: true,
      isRequired: false,
      relation: { model: 'Post' }
    })
  ]
};

const event = { locals: { userId: 7 } };

describe('redactForAudit', () => {
  it('ôte les champs sensibles par nom et les hidden, garde id et scalaires ordinaires', () => {
    const out = redactForAudit(
      {
        id: 1,
        email: 'a@b.c',
        password: 'secret',
        sessionToken: 'tok',
        bio: 'hi',
        extra: 'leak'
      },
      User,
      new Set(['bio'])
    );
    expect(out).toEqual({ id: 1, email: 'a@b.c' });
  });

  it('ignore les champs relation / liste même présents sur l’enregistrement', () => {
    expect(redactForAudit({ id: 1, email: 'a@b.c', posts: [{ id: 2 }] }, User, new Set())).toEqual({
      id: 1,
      email: 'a@b.c'
    });
  });

  it('n’ajoute pas une clé absente de l’enregistrement', () => {
    expect(redactForAudit({ email: 'a@b.c' }, User, new Set())).toEqual({ email: 'a@b.c' });
  });
});

describe('diffRecords', () => {
  it('n’émet rien pour une valeur inchangée', () => {
    expect(diffRecords({ email: 'a@b.c' }, { email: 'a@b.c' })).toEqual({});
  });

  it('émet { from, to } pour une string changée', () => {
    expect(diffRecords({ email: 'old@x.y' }, { email: 'new@x.y' })).toEqual({
      email: { from: 'old@x.y', to: 'new@x.y' }
    });
  });

  it('traite deux Date au même instant comme égales', () => {
    const a = new Date('2026-01-02T03:04:05.000Z');
    const b = new Date(a.getTime());
    expect(diffRecords({ createdAt: a }, { createdAt: b })).toEqual({});
  });

  it('émet un changement pour deux Date distinctes', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-02T00:00:00.000Z');
    expect(diffRecords({ createdAt: from }, { createdAt: to })).toEqual({
      createdAt: { from, to }
    });
  });

  it('compare les bigint par valeur', () => {
    expect(diffRecords({ visits: 1n }, { visits: 1n })).toEqual({});
    expect(diffRecords({ visits: 1n }, { visits: 2n })).toEqual({
      visits: { from: 1n, to: 2n }
    });
  });

  it('un bigint et un number sont différents', () => {
    expect(diffRecords({ visits: 1n }, { visits: 1 })).toEqual({
      visits: { from: 1n, to: 1 }
    });
  });

  it('compare les objets Json via JSON.stringify', () => {
    expect(diffRecords({ metadata: { a: 1 } }, { metadata: { a: 1 } })).toEqual({});
    expect(diffRecords({ metadata: { a: 1 } }, { metadata: { a: 2 } })).toEqual({
      metadata: { from: { a: 1 }, to: { a: 2 } }
    });
  });

  it('un objet circulaire est considéré différent (JSON.stringify throw)', () => {
    const left: Record<string, unknown> = {};
    left.self = left;
    const right: Record<string, unknown> = {};
    right.self = right;
    expect(diffRecords({ metadata: left }, { metadata: right })).toEqual({
      metadata: { from: left, to: right }
    });
  });

  it('deux scalaires distincts (ni Date ni objet) sont un changement', () => {
    expect(diffRecords({ n: 1 }, { n: 2 })).toEqual({ n: { from: 1, to: 2 } });
  });

  it('une clé seulement à gauche compte comme passage à undefined', () => {
    expect(diffRecords({ email: 'a@b.c' }, {})).toEqual({
      email: { from: 'a@b.c', to: undefined }
    });
  });
});

describe('readAuditSnapshot', () => {
  it('retourne la ligne', async () => {
    const row = { id: 1 };
    await expect(readAuditSnapshot(async () => row, User, 1)).resolves.toBe(row);
  });

  it('retourne null si getRecord retourne null', async () => {
    await expect(readAuditSnapshot(async () => null, User, 1)).resolves.toBeNull();
  });

  it('retourne null si getRecord throw', async () => {
    await expect(
      readAuditSnapshot(async () => {
        throw new Error('boom');
      }, User, 1)
    ).resolves.toBeNull();
  });
});

describe('emitAudit', () => {
  const entry: AuditEvent = {
    event,
    at: new Date('2026-08-14T00:00:00.000Z'),
    action: 'delete',
    model: 'User',
    id: 1,
    before: { id: 1, email: 'a@b.c' }
  };

  it('no-op si le callback est absent', async () => {
    await expect(emitAudit(undefined, entry)).resolves.toBeUndefined();
  });

  it('appelle un callback sync', async () => {
    const audit = vi.fn();
    await emitAudit(audit, entry);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(entry);
  });

  it('await un callback async avant de résoudre', async () => {
    const order: string[] = [];
    const audit = vi.fn(async () => {
      await Promise.resolve();
      order.push('audit-done');
    });
    await emitAudit(audit, entry);
    order.push('after-emit');
    expect(order).toEqual(['audit-done', 'after-emit']);
  });

  it('avale un throw et le journalise, sans rejeter', async () => {
    const err = new Error('sink down');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      emitAudit(() => {
        throw err;
      }, entry)
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('[sveltekit-admin] audit callback failed:', err);
  });
});

describe('buildAuditEvent', () => {
  const at = new Date('2026-08-14T12:00:00.000Z');

  it('create : values/after redactés, m2m omis si vide, at injectable', () => {
    const entry = buildAuditEvent({
      event,
      at,
      action: 'create',
      model: User,
      id: 99,
      hidden: new Set(),
      values: { email: 'n@x.y', password: 'p' },
      after: { id: 99, email: 'n@x.y', password: 'p' },
      m2m: {}
    });
    expect(entry).toEqual({
      event,
      at,
      action: 'create',
      model: 'User',
      id: 99,
      values: { email: 'n@x.y' },
      after: { id: 99, email: 'n@x.y' }
    });
  });

  it('create : m2m présent y compris tableau vide, values/after par défaut {}', () => {
    const entry = buildAuditEvent({
      event,
      action: 'create',
      model: User,
      id: 1,
      hidden: new Set(),
      m2m: { tags: { targetPkField: 'id', ids: [] } }
    });
    expect(entry.action).toBe('create');
    expect(entry.at).toBeInstanceOf(Date);
    if (entry.action !== 'create') throw new Error('expected create');
    expect(entry.values).toEqual({});
    expect(entry.after).toEqual({});
    expect(entry.m2m).toEqual({ tags: [] });
  });

  it('update : calcule changes, fusionne after par-dessus before, omet hidden', () => {
    const entry = buildAuditEvent({
      event,
      at,
      action: 'update',
      model: User,
      id: 1,
      hidden: new Set(['bio']),
      values: { email: 'new@x.y', bio: 'nope', password: 'p' },
      before: { id: 1, email: 'old@x.y', bio: 'old', password: 'secret' },
      after: { email: 'new@x.y' }
    });
    expect(entry.action).toBe('update');
    if (entry.action !== 'update') throw new Error('expected update');
    expect(entry.values).toEqual({ email: 'new@x.y' });
    expect(entry.before).toEqual({ id: 1, email: 'old@x.y' });
    expect(entry.after).toEqual({ id: 1, email: 'new@x.y' });
    expect(entry.changes).toEqual({
      email: { from: 'old@x.y', to: 'new@x.y' }
    });
    expect(entry.m2m).toBeUndefined();
  });

  it('update : before null → changes {}, before redacté null', () => {
    const entry = buildAuditEvent({
      event,
      at,
      action: 'update',
      model: User,
      id: 1,
      hidden: new Set(),
      values: { email: 'n@x.y' },
      before: null,
      after: { id: 1, email: 'n@x.y' }
    });
    if (entry.action !== 'update') throw new Error('expected update');
    expect(entry.before).toBeNull();
    expect(entry.changes).toEqual({});
    expect(entry.after).toEqual({ id: 1, email: 'n@x.y' });
  });

  it('update : after omis fusionne seulement before', () => {
    const entry = buildAuditEvent({
      event,
      at,
      action: 'update',
      model: User,
      id: 1,
      hidden: new Set(),
      values: { email: 'a@b.c' },
      before: { id: 1, email: 'a@b.c' }
    });
    if (entry.action !== 'update') throw new Error('expected update');
    expect(entry.after).toEqual({ id: 1, email: 'a@b.c' });
    expect(entry.changes).toEqual({});
  });

  it('update : m2m soumis est compacté', () => {
    const entry = buildAuditEvent({
      event,
      at,
      action: 'update',
      model: User,
      id: 1,
      hidden: new Set(),
      values: { email: 'a@b.c' },
      before: { id: 1, email: 'a@b.c' },
      after: { id: 1, email: 'a@b.c' },
      m2m: { tags: { targetPkField: 'id', ids: [1, 2] } }
    });
    if (entry.action !== 'update') throw new Error('expected update');
    expect(entry.m2m).toEqual({ tags: [1, 2] });
    expect(entry.changes).toEqual({});
  });

  it('delete : before redacté, ou null', () => {
    const withRow = buildAuditEvent({
      event,
      at,
      action: 'delete',
      model: User,
      id: 1,
      hidden: new Set(),
      before: { id: 1, email: 'a@b.c', password: 'x' }
    });
    expect(withRow).toEqual({
      event,
      at,
      action: 'delete',
      model: 'User',
      id: 1,
      before: { id: 1, email: 'a@b.c' }
    });

    const missing = buildAuditEvent({
      event,
      at,
      action: 'delete',
      model: User,
      id: 1,
      hidden: new Set()
    });
    expect(missing).toEqual({
      event,
      at,
      action: 'delete',
      model: 'User',
      id: 1,
      before: null
    });
  });
});
