/**
 * Compiles the generic `Filter` AST (see ../types.ts) into a Prisma `where`
 * object. This is the ONLY place in the Prisma adapter that knows Prisma's
 * where-clause vocabulary (`AND`/`OR`/`contains`/`startsWith`/`gte`/`lte`/
 * `equals`/`not`/`in`/`mode: 'insensitive'`).
 */
import type { Filter, LeafFilter } from '../types.js';
import { isCompositeFilter, isLeafFilter } from '../filter.js';

export type PrismaWhere = Record<string, unknown>;

function compileLeaf(filter: LeafFilter, caseInsensitiveSearch: boolean): PrismaWhere {
  switch (filter.op) {
    case 'eq':
      return { [filter.field]: filter.value };
    case 'contains':
      return caseInsensitiveSearch
        ? { [filter.field]: { contains: filter.value, mode: 'insensitive' } }
        : { [filter.field]: { contains: filter.value } };
    case 'containsExact':
      return { [filter.field]: { contains: filter.value } };
    case 'startsWith':
      return { [filter.field]: { startsWith: filter.value } };
    case 'gte':
      return { [filter.field]: { gte: filter.value } };
    case 'lte':
      return { [filter.field]: { lte: filter.value } };
    case 'lt':
      return { [filter.field]: { lt: filter.value } };
    case 'in':
      return { [filter.field]: { in: filter.value } };
    case 'isNull':
      return { [filter.field]: { equals: null } };
    case 'isNotNull':
      return { [filter.field]: { not: null } };
  }
}

function compile(node: Filter | PrismaWhere, caseInsensitiveSearch: boolean): PrismaWhere {
  if (isCompositeFilter(node)) {
    const clauses = node.clauses.map((c) => compile(c, caseInsensitiveSearch));
    return node.op === 'and' ? { AND: clauses } : { OR: clauses };
  }
  if (isLeafFilter(node)) {
    return compileLeaf(node, caseInsensitiveSearch);
  }
  return node as PrismaWhere;
}

export function compileFilterToPrismaWhere(
  filter: Filter | PrismaWhere | undefined,
  caseInsensitiveSearch: boolean
): PrismaWhere | undefined {
  if (filter === undefined) return undefined;
  return compile(filter, caseInsensitiveSearch);
}
