import { describe, it, expect } from 'vitest';
import { isCompositeFilter, isLeafFilter, isFlatEqMap, normalizeScope } from '../../../src/lib/server/adapters/filter.js';

describe('isLeafFilter / isCompositeFilter — discrimination structurelle', () => {
  it('leaf reconnue seulement avec op whitelisté + field string', () => {
    expect(isLeafFilter({ op: 'eq', field: 'id', value: 1 })).toBe(true);
    expect(isLeafFilter({ op: 'containsExact', field: 'name', value: 'x' })).toBe(true);
    expect(isLeafFilter({ op: 'read', field: 'id' })).toBe(false);
    expect(isLeafFilter({ op: 'eq' })).toBe(false);
  });

  it('composite reconnue seulement avec and/or + clauses array', () => {
    expect(isCompositeFilter({ op: 'and', clauses: [] })).toBe(true);
    expect(isCompositeFilter({ op: 'and', tenantId: 1 })).toBe(false);
  });
});

describe('isFlatEqMap / normalizeScope', () => {
  it('objet plat de scalaires → eq (une clé) ou and (plusieurs)', () => {
    expect(isFlatEqMap({ tenantId: 1 })).toBe(true);
    expect(normalizeScope({ tenantId: 1 })).toEqual({ op: 'eq', field: 'tenantId', value: 1 });
    expect(normalizeScope({ tenantId: 1, published: true })).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', field: 'tenantId', value: 1 },
        { op: 'eq', field: 'published', value: true }
      ]
    });
  });

  it('accepte Date, bigint, null comme scalaires ; refuse undefined, objet, tableau, {}', () => {
    expect(isFlatEqMap({ at: new Date('2020-01-01T00:00:00.000Z') })).toBe(true);
    expect(isFlatEqMap({ n: 1n })).toBe(true);
    expect(isFlatEqMap({ x: null })).toBe(true);
    expect(isFlatEqMap({ x: undefined })).toBe(false);
    expect(isFlatEqMap({ author: { is: { tenantId: 1 } } })).toBe(false);
    expect(isFlatEqMap({ id: { in: [1, 2] } })).toBe(false);
    expect(isFlatEqMap({})).toBe(false);
  });

  it('Filter déjà formé : renvoyé tel quel', () => {
    const leaf = { op: 'eq' as const, field: 'id', value: 1 };
    expect(normalizeScope(leaf)).toBe(leaf);
    const and = { op: 'and' as const, clauses: [leaf] };
    expect(normalizeScope(and)).toBe(and);
  });

  it('opaque (where Prisma imbriqué) : renvoyé tel quel', () => {
    const nested = { author: { is: { tenantId: 1 } } };
    expect(normalizeScope(nested)).toBe(nested);
  });

  it('undefined → undefined', () => {
    expect(normalizeScope(undefined)).toBeUndefined();
  });
});
