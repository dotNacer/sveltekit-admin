/**
 * ORM-agnostic where-clause AST. `listQuery.ts#buildWhere` produces this;
 * each adapter's own `filterCompiler` (see `adapters/prisma/filterCompiler.ts`)
 * turns it into that ORM's native query shape. Never expose an ORM-specific
 * operator here (no `mode: 'insensitive'`, no Prisma `not`) — those are
 * compiler-side decisions made from `LeafFilter.op`, not carried in the AST.
 */
export type Filter = CompositeFilter | LeafFilter;

export interface CompositeFilter {
  op: 'and' | 'or';
  clauses: Filter[];
}

export interface LeafFilter {
  op: 'eq' | 'contains' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull';
  field: string;
  value?: unknown;
}
