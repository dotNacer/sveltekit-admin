import type { CompositeFilter, Filter, LeafFilter } from './types.js';

export const OPAQUE_FILTER_ERROR =
  'nested Prisma `where` is not supported by the Drizzle adapter; return a Filter or a flat `{ field: scalar }` map';

export const LEAF_OPS = new Set<LeafFilter['op']>([
  'eq',
  'contains',
  'containsExact',
  'startsWith',
  'gte',
  'lte',
  'lt',
  'in',
  'isNull',
  'isNotNull'
]);

export function isCompositeFilter(node: unknown): node is CompositeFilter {
  return (
    typeof node === 'object' &&
    node !== null &&
    'op' in node &&
    (node.op === 'and' || node.op === 'or') &&
    'clauses' in node &&
    Array.isArray((node as { clauses: unknown }).clauses)
  );
}

export function isLeafFilter(node: unknown): node is LeafFilter {
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

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value instanceof Date
  );
}

/** Flat `{ field: scalar }` map — the 99% listWhere sugar. Empty `{}` is NOT flat (handler throws on listWhere `{}`; other callers keep it opaque). */
export function isFlatEqMap(node: unknown): node is Record<string, string | number | boolean | bigint | Date | null> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  if (isLeafFilter(node) || isCompositeFilter(node)) return false;
  const values = Object.values(node as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.every(isScalar);
}

function flatEqMapToFilter(map: Record<string, unknown>): Filter {
  const clauses: LeafFilter[] = Object.entries(map).map(([field, value]) => ({
    op: 'eq',
    field,
    value
  }));
  if (clauses.length === 1) return clauses[0];
  return { op: 'and', clauses };
}

/**
 * Turns a listWhere / relations.where return value into a Filter when we can
 * do so without guessing. Nested Prisma where objects stay opaque.
 */
export function normalizeScope(
  scope: Record<string, unknown> | Filter | undefined
): Filter | Record<string, unknown> | undefined {
  if (scope === undefined) return undefined;
  if (isLeafFilter(scope) || isCompositeFilter(scope)) return scope;
  if (isFlatEqMap(scope)) return flatEqMapToFilter(scope);
  return scope;
}
