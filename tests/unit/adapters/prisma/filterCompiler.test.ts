import { describe, it, expect } from 'vitest';
import { compileFilterToPrismaWhere } from '../../../../src/lib/server/adapters/prisma/filterCompiler.js';

describe('compileFilterToPrismaWhere', () => {
  it('undefined → undefined', () => {
    expect(compileFilterToPrismaWhere(undefined, false)).toBeUndefined();
  });

  it('leaf eq', () => {
    expect(compileFilterToPrismaWhere({ op: 'eq', field: 'views', value: 5 }, false)).toEqual({ views: 5 });
  });

  it('leaf contains, sensible à la casse', () => {
    expect(compileFilterToPrismaWhere({ op: 'contains', field: 'title', value: 'x' }, false)).toEqual({
      title: { contains: 'x' }
    });
  });

  it('leaf contains, insensible à la casse (mode Prisma)', () => {
    expect(compileFilterToPrismaWhere({ op: 'contains', field: 'title', value: 'x' }, true)).toEqual({
      title: { contains: 'x', mode: 'insensitive' }
    });
  });

  it('leaf startsWith', () => {
    expect(compileFilterToPrismaWhere({ op: 'startsWith', field: 'title', value: 'x' }, false)).toEqual({
      title: { startsWith: 'x' }
    });
  });

  it.each(['gte', 'lte', 'lt'] as const)('leaf %s', (op) => {
    expect(compileFilterToPrismaWhere({ op, field: 'views', value: 5 }, false)).toEqual({
      views: { [op]: 5 }
    });
  });

  it('leaf in', () => {
    expect(compileFilterToPrismaWhere({ op: 'in', field: 'id', value: [1, 2] }, false)).toEqual({
      id: { in: [1, 2] }
    });
  });

  it('leaf isNull → {equals: null}', () => {
    expect(compileFilterToPrismaWhere({ op: 'isNull', field: 'content' }, false)).toEqual({
      content: { equals: null }
    });
  });

  it('leaf isNotNull → {not: null}', () => {
    expect(compileFilterToPrismaWhere({ op: 'isNotNull', field: 'content' }, false)).toEqual({
      content: { not: null }
    });
  });

  it('composite and, avec un scope brut mêlé à des leaves', () => {
    const compiled = compileFilterToPrismaWhere(
      { op: 'and', clauses: [{ tenantId: 1 }, { op: 'eq', field: 'views', value: 5 }] },
      false
    );
    expect(compiled).toEqual({ AND: [{ tenantId: 1 }, { views: 5 }] });
  });

  it('composite or', () => {
    const compiled = compileFilterToPrismaWhere(
      { op: 'or', clauses: [{ op: 'contains', field: 'title', value: 'a' }, { op: 'contains', field: 'slug', value: 'a' }] },
      false
    );
    expect(compiled).toEqual({ OR: [{ title: { contains: 'a' } }, { slug: { contains: 'a' } }] });
  });

  it('and imbriqué dans or', () => {
    const compiled = compileFilterToPrismaWhere(
      {
        op: 'or',
        clauses: [{ op: 'and', clauses: [{ op: 'gte', field: 'views', value: 1 }, { op: 'lt', field: 'views', value: 10 }] }]
      },
      false
    );
    expect(compiled).toEqual({ OR: [{ AND: [{ views: { gte: 1 } }, { views: { lt: 10 } }] }] });
  });

  it('un scope brut seul (pas de wrapper) passe tel quel', () => {
    expect(compileFilterToPrismaWhere({ tenantId: 1 }, false)).toEqual({ tenantId: 1 });
  });

  it('scope brut avec un champ littéralement nommé `op` (valeur non reconnue) passe tel quel, sans devenir undefined', () => {
    expect(compileFilterToPrismaWhere({ op: 'read', tenantId: 1 }, false)).toEqual({
      op: 'read',
      tenantId: 1
    });
  });

  it('scope brut avec op "and"/"or" mais sans tableau `clauses` passe tel quel, sans throw', () => {
    expect(compileFilterToPrismaWhere({ op: 'and', tenantId: 1 }, false)).toEqual({
      op: 'and',
      tenantId: 1
    });
    expect(compileFilterToPrismaWhere({ op: 'or', tenantId: 1 }, false)).toEqual({
      op: 'or',
      tenantId: 1
    });
  });

  it('leaf containsExact → { contains } sans mode, même si caseInsensitiveSearch', () => {
    expect(compileFilterToPrismaWhere({ op: 'containsExact', field: 'name', value: 'ALI' }, true)).toEqual({
      name: { contains: 'ALI' }
    });
    expect(compileFilterToPrismaWhere({ op: 'containsExact', field: 'name', value: 'ALI' }, false)).toEqual({
      name: { contains: 'ALI' }
    });
  });
});
