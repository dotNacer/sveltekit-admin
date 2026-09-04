import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminRuntime, modelScopeFrom, modelScopeValues } from '../../src/lib/server/runtime.js';
import { combinedScope, filterSelectedIds } from '../../src/lib/server/relationLoaders.js';
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

  it('modelScopeValues extrait les égalités et refuse les scopes ambigus', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ email: 'tenant@example.test', role: 'ADMIN' }) } }
    });
    expect(modelScopeValues(rt, rt.findModel('User')!, { locals: {} })).toEqual({
      email: 'tenant@example.test',
      role: 'ADMIN'
    });
    const ambiguous = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ op: 'or', clauses: [] }) } }
    });
    expect(() => modelScopeValues(ambiguous, ambiguous.findModel('User')!, { locals: {} })).toThrow(/equality|invalid condition/);
    const missing = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ email: undefined }) } }
    });
    expect(() => modelScopeValues(missing, missing.findModel('User')!, { locals: {} })).toThrow(/equality|invalid condition/);
    const contradictory = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ op: 'and', clauses: [{ op: 'eq', field: 'tenantId', value: 1 }, { op: 'eq', field: 'tenantId', value: 2 }] }) } }
    });
    expect(() => modelScopeValues(contradictory, contradictory.findModel('User')!, { locals: {} })).toThrow(/equality/);
    const empty = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { scope: () => ({}) } } });
    expect(() => modelScopeFrom(empty, empty.findModel('User')!, { locals: {} })).toThrow(/non-empty/);
    const absent = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { scope: () => undefined } } });
    expect(() => modelScopeFrom(absent, absent.findModel('User')!, { locals: {} })).toThrow(/non-empty/);
    expect(combinedScope()).toBeUndefined();
    expect(combinedScope({ email: 'a@example.test' })).toEqual({ op: 'eq', field: 'email', value: 'a@example.test' });
    expect(combinedScope({ email: 'a@example.test' }, { role: 'ADMIN' })).toEqual({
      op: 'and', clauses: [
        { op: 'eq', field: 'email', value: 'a@example.test' },
        { op: 'eq', field: 'role', value: 'ADMIN' }
      ]
    });
    const missingLeaf = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ op: 'eq', field: 'email' }) } }
    });
    expect(() => modelScopeValues(missingLeaf, missingLeaf.findModel('User')!, { locals: {} })).toThrow(/equality|invalid condition/);
    const nonEquality = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ op: 'contains', field: 'email', value: '@tenant.test' }) } }
    });
    expect(() => modelScopeValues(nonEquality, nonEquality.findModel('User')!, { locals: {} })).toThrow(/equality/);
    const invalid = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { scope: () => ['invalid'] as any } } });
    expect(() => modelScopeFrom(invalid, invalid.findModel('User')!, { locals: {} })).toThrow(/invalid condition/);
    const unscoped = runtimeFor(FULL_SCHEMA_PATH);
    expect(modelScopeValues(unscoped, unscoped.findModel('User')!, { locals: {} })).toEqual({});
  });

  it('filtre les IDs m2m sélectionnés avec le scope du modèle cible', async () => {
    const unscoped = runtimeFor(FULL_SCHEMA_PATH);
    const user = unscoped.findModel('User')!;
    expect(await filterSelectedIds(unscoped, user, undefined, { locals: {} })).toBeUndefined();
    expect(await filterSelectedIds(unscoped, user, [1], { locals: {} })).toEqual([1]);

    const scoped = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { scope: () => ({ email: 'tenant@example.test' }) } }
    });
    const findMany = vi.fn().mockResolvedValue([{ id: 2 }]);
    scoped.adapter.data.findMany = findMany;
    const scopedUser = scoped.findModel('User')!;
    expect(await filterSelectedIds(scoped, scopedUser, [], { locals: {} })).toEqual([]);
    expect(await filterSelectedIds(scoped, scopedUser, [1, 2], { locals: {} })).toEqual([2]);
    expect(findMany).toHaveBeenCalledOnce();
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

  it('résout le dashboard au démarrage', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH);
    expect(rt.dashboard.widgets[0]).toEqual({ type: 'stats' });
  });

  it('refuse une config de dashboard invalide au démarrage, pas au rendu', () => {
    expect(() =>
      runtimeFor(FULL_SCHEMA_PATH, { dashboard: { widgets: [{ type: 'models', models: ['Nope'] }] } })
    ).toThrow(/unknown or excluded/);
  });

  it('refuse un widget qui vise un modèle exclu', () => {
    expect(() =>
      runtimeFor(FULL_SCHEMA_PATH, {
        exclude: ['Post'],
        dashboard: { widgets: [{ type: 'models', models: ['Post'] }] }
      })
    ).toThrow(/references model "Post", which is unknown or excluded/);
  });

  it('résout un widget count via le runtime, avec les search/filterable fields réels', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, {
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }]
      }
    });
    expect(rt.dashboard.widgets[0]).toMatchObject({
      type: 'count',
      modelName: 'User',
      label: 'Actifs',
      href: '/admin/user?f.isActive=true'
    });
  });

  it('un widget count respecte models[].searchFields configuré pour ce modèle', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { searchFields: ['email'] } },
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Recherche', query: 'q=bob' }]
      }
    });
    const widget = rt.dashboard.widgets[0] as any;
    expect(widget.query.searchFields).toEqual(['email']);
  });

  it('résout un widget recent via le runtime, avec le libellé et le tri réels', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, {
      dashboard: { widgets: [{ type: 'recent', model: 'User', sort: 'email', dir: 'desc' }] }
    });
    expect(rt.dashboard.widgets[0]).toEqual({
      type: 'recent',
      modelName: 'User',
      title: 'Latest User',
      limit: 5,
      orderBy: { email: 'desc' },
      href: '/admin/user'
    });
  });

  it('un widget recent trié refuse un champ masqué via models[].hidden', () => {
    // `bio` est un champ normal (String, non sensible par nom) qui figurerait
    // dans les colonnes triables si `hidden` n'était pas pris en compte ici —
    // le test précédent triait sur `email`, qui n'est pas masqué, et restait
    // vert même sans le câblage `hidden`. Trier sur la colonne masquée elle-même
    // est la seule façon de prouver que `hidden` ferme aussi ce chemin.
    expect(() =>
      runtimeFor(FULL_SCHEMA_PATH, {
        models: { User: { hidden: ['bio'] } },
        dashboard: { widgets: [{ type: 'recent', model: 'User', sort: 'bio' }] }
      })
    ).toThrow(/does not display/);
  });

  it('un widget count refuse un filtre f.* sur un champ masqué via models[].hidden', () => {
    expect(() =>
      runtimeFor(FULL_SCHEMA_PATH, {
        models: { User: { hidden: ['bio'] } },
        dashboard: {
          widgets: [{ type: 'count', model: 'User', label: 'Bio', query: 'f.bio=hello' }]
        }
      })
    ).toThrow(/query rejects/);
  });

  it('un widget recent respecte le defaultSort configuré pour ce modèle', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, {
      models: { User: { defaultSort: { field: 'email', dir: 'asc' } } },
      dashboard: { widgets: [{ type: 'recent', model: 'User' }] }
    });
    expect(rt.dashboard.widgets[0]).toMatchObject({ orderBy: { email: 'asc' } });
  });

  it('un widget recent refuse un tri sur une colonne que la liste n’affiche pas', () => {
    expect(() =>
      runtimeFor(FULL_SCHEMA_PATH, {
        dashboard: { widgets: [{ type: 'recent', model: 'User', sort: 'password' }] }
      })
    ).toThrow(/does not display/);
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
