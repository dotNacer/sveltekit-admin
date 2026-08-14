import type { DataAdapter, SchemaIntrospector } from "../types.js";
import { createDrizzleDataAdapter } from "./dataAdapter.js";
import { inspectDrizzleSchema } from "./inspect.js";
import type { DrizzleDialect } from "./inspect.js";
import { createDrizzleIntrospector } from "./introspector.js";

export type { DrizzleDialect };

export function resolveCaseInsensitiveSearch(
  dialect: DrizzleDialect,
  searchMode: "auto" | "insensitive" | "default" = "auto",
): boolean {
  if (searchMode === "insensitive") return true;
  if (searchMode === "default") return false;
  return dialect === "postgresql";
}

export function createDrizzleAdapter(opts: {
  db: any;
  schema: Record<string, unknown>;
  dialect?: DrizzleDialect;
  searchMode?: "auto" | "insensitive" | "default";
}): { introspector: SchemaIntrospector; data: DataAdapter } {
  const inspected = inspectDrizzleSchema(opts.schema, opts.dialect);
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(
    inspected.dialect,
    opts.searchMode,
  );

  return {
    introspector: createDrizzleIntrospector(inspected.schema),
    data: createDrizzleDataAdapter(opts.db, {
      tables: inspected.tables,
      m2m: inspected.m2m,
      dialect: inspected.dialect,
      caseInsensitiveSearch,
    }),
  };
}
