import {
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Column, SQL, Table } from "drizzle-orm";
import { isCompositeFilter, isLeafFilter } from "../filter.js";
import type { Filter, LeafFilter } from "../types.js";
import type { DrizzleDialect } from "./inspect.js";

const OPAQUE_FILTER_ERROR =
  "nested Prisma `where` is not supported by the Drizzle adapter; return a Filter or a flat `{ field: scalar }` map";

function escapeLikePattern(value: unknown): string {
  return String(value).replace(/([%_!])/g, "!$1");
}

function likeWithEscape(column: Column, pattern: string): SQL {
  return sql`${column} like ${pattern} escape '!'`;
}

function ilikeWithEscape(column: Column, pattern: string): SQL {
  return sql`${column} ilike ${pattern} escape '!'`;
}

function compileLeaf(
  table: Table,
  filter: LeafFilter,
  opts: { caseInsensitiveSearch: boolean; dialect: DrizzleDialect },
): SQL {
  const columns = getTableColumns(table) as Record<string, Column>;
  const column = columns[filter.field];
  if (!column) {
    throw new Error(
      `[sveltekit-admin] unknown field '${filter.field}' on Drizzle table`,
    );
  }

  switch (filter.op) {
    case "eq":
      return eq(column, filter.value);
    case "contains": {
      const pattern = `%${escapeLikePattern(filter.value)}%`;
      if (!opts.caseInsensitiveSearch) return likeWithEscape(column, pattern);
      if (opts.dialect === "postgresql")
        return ilikeWithEscape(column, pattern);
      return sql`lower(${column}) like lower(${pattern}) escape '!'`;
    }
    case "containsExact":
      return likeWithEscape(column, `%${escapeLikePattern(filter.value)}%`);
    case "startsWith":
      return likeWithEscape(column, `${escapeLikePattern(filter.value)}%`);
    case "gte":
      return gte(column, filter.value);
    case "lte":
      return lte(column, filter.value);
    case "lt":
      return lt(column, filter.value);
    case "in":
      return inArray(column, filter.value as readonly unknown[]);
    case "isNull":
      return isNull(column);
    case "isNotNull":
      return isNotNull(column);
  }
}

function compile(
  table: Table,
  node: Filter | Record<string, unknown>,
  opts: { caseInsensitiveSearch: boolean; dialect: DrizzleDialect },
): SQL {
  if (isCompositeFilter(node)) {
    const clauses = node.clauses.map((clause) => compile(table, clause, opts));
    return node.op === "and" ? and(...clauses)! : or(...clauses)!;
  }
  if (isLeafFilter(node)) return compileLeaf(table, node, opts);
  throw new Error(OPAQUE_FILTER_ERROR);
}

export function compileFilterToDrizzle(
  table: Table,
  filter: Filter | Record<string, unknown> | undefined,
  opts: { caseInsensitiveSearch: boolean; dialect: DrizzleDialect },
): SQL | undefined {
  if (filter === undefined) return undefined;
  return compile(table, filter, opts);
}
