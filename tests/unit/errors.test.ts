import { describe, it, expect } from 'vitest';
import { AdminMutationError, classifyWriteError, codeOf } from '../../src/lib/server/errors.js';

describe('codeOf', () => {
  it('lit `code` à la racine (pg, mysql2, better-sqlite3)', () => {
    expect(codeOf({ code: '23505' })).toBe('23505');
  });

  it('lit `meta.code` (PrismaClientKnownRequestError en transaction)', () => {
    expect(codeOf({ meta: { code: '40001' } })).toBe('40001');
  });

  it('renvoie undefined sur une erreur sans code exploitable', () => {
    expect(codeOf(new Error('boom'))).toBeUndefined();
    expect(codeOf(null)).toBeUndefined();
    expect(codeOf({ code: 42 })).toBeUndefined();
  });
});

describe('classifyWriteError', () => {
  it("classe une violation d'unicité sur les quatre moteurs", () => {
    for (const code of ['P2002', '23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE']) {
      expect(classifyWriteError({ code }, 'create')?.kind).toBe('conflict');
    }
  });

  it('classe une violation de FK en `reference` sur create/update', () => {
    expect(classifyWriteError({ code: '23503' }, 'create')?.kind).toBe('reference');
    expect(classifyWriteError({ code: 'P2003' }, 'update')?.kind).toBe('reference');
  });

  it('classe la même violation de FK en `restrict` sur delete', () => {
    expect(classifyWriteError({ code: '23503' }, 'delete')?.kind).toBe('restrict');
    expect(classifyWriteError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }, 'delete')?.kind).toBe(
      'restrict'
    );
  });

  it('classe une ligne absente en `notFound`', () => {
    expect(classifyWriteError({ code: 'P2025' }, 'update')?.kind).toBe('notFound');
  });

  it("renvoie null sur un code inconnu — l'appelant décidera du générique", () => {
    expect(classifyWriteError({ code: 'ER_SOMETHING_ELSE' }, 'create')).toBeNull();
    expect(classifyWriteError(new Error('connexion perdue'), 'create')).toBeNull();
  });

  it("laisse passer une AdminMutationError déjà typée sans la reclasser", () => {
    const original = new AdminMutationError('conflict', 'email: already used', 'email');
    expect(classifyWriteError(original, 'create')).toBe(original);
  });
});

describe('AdminMutationError', () => {
  it('porte kind, field et message, et reste une Error', () => {
    const e = new AdminMutationError('validation', 'author: invalid value', 'author');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('validation');
    expect(e.field).toBe('author');
    expect(e.message).toBe('author: invalid value');
  });

  it("accepte l'absence de champ", () => {
    expect(new AdminMutationError('unknown', 'boom').field).toBeUndefined();
  });
});
