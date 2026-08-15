import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import {
  createPrismaMock,
  FULL_SCHEMA_PATH,
  PIVOT_SCHEMA_PATH,
  SEARCH_SCHEMA_PATH
} from '../fixtures/prismaMock.js';

afterEach(() => vi.restoreAllMocks());

function runtimeFor(
  schemaPath: string,
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({})
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath });
  return createAdminRuntime({ adapter, ...config } as any);
}

describe('createAdminRuntime', () => {
  it('filtre exclude', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { exclude: ['Post'] });
    expect(rt.models.map((m) => m.name)).not.toContain('Post');
    expect(rt.models.map((m) => m.name)).toContain('User');
    expect(rt.findModel('post')).toBeUndefined();
  });

  it('findModel est insensible à la casse', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH);
    expect(rt.findModel('user')?.name).toBe('User');
    expect(rt.findModel('USER')?.name).toBe('User');
  });

  it('labelOf utilise models[].label sinon toLabel capitalisé', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { label: 'Accounts' } } });
    const user = rt.findModel('User')!;
    expect(rt.labelOf(user)).toBe('Accounts');
    const post = rt.findModel('Post')!;
    expect(rt.labelOf(post)).toBe('Post');
  });

  it('hidePivotTables: true masque les pivots (défaut)', () => {
    const rt = runtimeFor(PIVOT_SCHEMA_PATH);
    expect(rt.models.some((m) => m.isPivotTable)).toBe(false);
  });

  it('hidePivotTables: false garde les pivots', () => {
    const rt = runtimeFor(PIVOT_SCHEMA_PATH, { hidePivotTables: false });
    expect(rt.models.some((m) => m.isPivotTable)).toBe(true);
  });

  it('listFilter invalide throw au boot', () => {
    expect(() =>
      runtimeFor(SEARCH_SCHEMA_PATH, { models: { Article: { listFilter: ['nope'] } } })
    ).toThrow(/no field "nope"/);
  });

  it('schéma illisible → models vide + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = {
      introspector: {
        introspect: () => {
          throw new Error('nope');
        }
      },
      data: {} as any
    };
    const rt = createAdminRuntime({ adapter } as any);
    expect(rt.models).toEqual([]);
    expect(rt.schema).toBeNull();
    expect(rt.relationGraph).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('introspect() Promise → même dégradation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = {
      introspector: {
        introspect: () => Promise.resolve({ models: [], enums: new Map(), provider: 'postgresql' })
      },
      data: {} as any
    };
    const rt = createAdminRuntime({ adapter } as any);
    expect(rt.models).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('resolveFilterableFields ferme hidden + sensible + json/bytes/relations', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { hidden: ['bio'] } } });
    const user = rt.findModel('User')!;
    const fields = rt.resolveFilterableFields(user);
    expect(fields.has('email')).toBe(true);
    expect(fields.has('password')).toBe(false);
    expect(fields.has('bio')).toBe(false);
    expect(fields.has('metadata')).toBe(false);
    expect(fields.has('avatar')).toBe(false);
    expect(fields.has('posts')).toBe(false);
  });

  it('resolveLabel : template, puis candidat String, sinon PK', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH);
    const user = rt.findModel('User')!;
    expect(rt.resolveLabel(user, { id: 9, name: 'Ada' }, '{name}#{id}')).toBe('Ada#9');
    expect(rt.resolveLabel(user, { id: 9, name: 'Ada', email: 'a@b.c' })).toBe('Ada');
    expect(rt.resolveLabel(user, { id: 9 })).toBe('9');
  });

  it('perPage vaut 20', () => {
    expect(runtimeFor(FULL_SCHEMA_PATH).perPage).toBe(20);
  });
});
