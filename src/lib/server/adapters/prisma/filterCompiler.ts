/**
 * Compiles the generic `Filter` AST (see ../types.ts) into a Prisma `where`
 * object. This is the ONLY place in the Prisma adapter that knows Prisma's
 * where-clause vocabulary (`AND`/`OR`/`contains`/`startsWith`/`gte`/`lte`/
 * `equals`/`not`/`in`/`mode: 'insensitive'`) — moved here unchanged from the
 * former end of `query/listQuery.ts#buildWhere`.
 */
import type { CompositeFilter, Filter, LeafFilter } from '../types.js';

export type PrismaWhere = Record<string, unknown>;

// Typed over `LeafFilter` (not `Filter`) so the compiler statically
// guarantees this is never called with a composite node — `compile` below
// is the only caller and it already branches on 'and'/'or' before reaching
// here, so a runtime guard for that case would be an unreachable branch the
// coverage gate would force us to fake-test (see CLAUDE.md's "no code for
// hypothetical inputs" convention).
function compileLeaf(filter: LeafFilter, caseInsensitiveSearch: boolean): PrismaWhere {
  switch (filter.op) {
    case 'eq':
      return { [filter.field]: filter.value };
    case 'contains':
      return caseInsensitiveSearch
        ? { [filter.field]: { contains: filter.value, mode: 'insensitive' } }
        : { [filter.field]: { contains: filter.value } };
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

const LEAF_OPS = new Set<LeafFilter['op']>([
  'eq',
  'contains',
  'startsWith',
  'gte',
  'lte',
  'lt',
  'in',
  'isNull',
  'isNotNull'
]);

/**
 * Structural (not duck-typed) discrimination: a raw scope/opaque object may
 * legitimately have a field literally named `op` (e.g. a developer's model
 * has a scalar column called `op`) — matching on `'op' in node` alone would
 * misidentify it as a `Filter` node and either drop it silently (leaf switch
 * has no `default`) or throw (composite has no `clauses`). Both shapes below
 * must match in full before we treat `node` as a genuine `Filter` node;
 * anything else falls through to the opaque pass-through.
 */
function isCompositeFilter(node: unknown): node is CompositeFilter {
  return (
    typeof node === 'object' &&
    node !== null &&
    'op' in node &&
    (node.op === 'and' || node.op === 'or') &&
    'clauses' in node &&
    Array.isArray((node as { clauses: unknown }).clauses)
  );
}

function isLeafFilter(node: unknown): node is LeafFilter {
  return (
    typeof node === 'object' &&
    node !== null &&
    'op' in node &&
    typeof (node as { op: unknown }).op === 'string' &&
    LEAF_OPS.has((node as { op: LeafFilter['op'] }).op) &&
    'field' in node &&
    typeof (node as { field: unknown }).field === 'string'
  );
}

/**
 * `scope`/opaque Prisma fragments composed by `buildWhere` alongside `Filter`
 * nodes flow straight through here as plain objects — `and`/`or` are the only
 * two shapes `buildWhere` ever nests a raw object inside, so a non-`Filter`
 * entry inside a `clauses` array is always one of those two escape hatches,
 * never a third node type to guard against. Discrimination is structural
 * (see `isCompositeFilter`/`isLeafFilter`) so an opaque object that merely
 * happens to have an `op` key never gets misidentified as a `Filter` node.
 */
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
