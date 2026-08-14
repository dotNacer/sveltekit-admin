import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/pg-proxy";
import { pgTable, serial, text as pgText } from "drizzle-orm/pg-core";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { compileFilterToDrizzle } from "../../../../src/lib/server/adapters/drizzle/filterCompiler.js";

const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  name: text("name"),
  tenantId: integer("tenant_id"),
});

function sqlOf(
  filter: Parameters<typeof compileFilterToDrizzle>[1],
  opts: {
    caseInsensitiveSearch?: boolean;
    dialect?: "postgresql" | "mysql" | "sqlite";
  } = {},
) {
  const sqlite = new Database(":memory:");
  try {
    const db = drizzle(sqlite);
    const where = compileFilterToDrizzle(users, filter, {
      caseInsensitiveSearch: opts.caseInsensitiveSearch ?? false,
      dialect: opts.dialect ?? "sqlite",
    });
    return db.select().from(users).where(where).toSQL();
  } finally {
    sqlite.close();
  }
}

describe("compileFilterToDrizzle", () => {
  it("returns undefined for an undefined filter", () => {
    expect(
      compileFilterToDrizzle(users, undefined, {
        caseInsensitiveSearch: false,
        dialect: "sqlite",
      }),
    ).toBeUndefined();
  });

  it("compiles equality against the physical column", () => {
    const { sql, params } = sqlOf({ op: "eq", field: "tenantId", value: 1 });
    expect(sql).toMatch(/tenant_id/);
    expect(params).toContain(1);
  });

  it("uses LIKE for case-sensitive contains", () => {
    const { sql, params } = sqlOf({
      op: "contains",
      field: "name",
      value: "Al",
    });
    expect(sql.toLowerCase()).toContain("like");
    expect(sql.toLowerCase()).not.toContain("ilike");
    expect(params.some((param) => String(param).includes("Al"))).toBe(true);
  });

  it("folds both sides for case-insensitive contains on sqlite", () => {
    const { sql } = sqlOf(
      { op: "contains", field: "name", value: "Al" },
      { caseInsensitiveSearch: true },
    );
    expect(sql.toLowerCase()).toMatch(/lower/);
    expect(sql.toLowerCase()).not.toContain("ilike");
  });

  it("folds both sides for case-insensitive contains on MySQL", () => {
    const { sql } = sqlOf(
      { op: "contains", field: "name", value: "Al" },
      { caseInsensitiveSearch: true, dialect: "mysql" },
    );
    expect(sql.toLowerCase()).toContain("lower");
    expect(sql.toLowerCase()).not.toContain("ilike");
    expect(sql.toLowerCase()).toContain("escape '!'");
  });

  it("uses ILIKE for case-insensitive contains on PostgreSQL", () => {
    const pgUsers = pgTable("users", {
      id: serial("id").primaryKey(),
      name: pgText("name"),
    });
    const where = compileFilterToDrizzle(
      pgUsers,
      { op: "contains", field: "name", value: "Al" },
      { caseInsensitiveSearch: true, dialect: "postgresql" },
    );
    const db = drizzlePg(async () => ({ rows: [] }));
    const { sql } = db.select().from(pgUsers).where(where).toSQL();
    expect(sql.toLowerCase()).toContain("ilike");
    expect(sql.toLowerCase()).toContain("escape '!'");
  });

  it("keeps containsExact case-sensitive when case-insensitive search is enabled", () => {
    const { sql } = sqlOf(
      { op: "containsExact", field: "name", value: "Al" },
      { caseInsensitiveSearch: true },
    );
    expect(sql.toLowerCase()).toContain("like");
    expect(sql.toLowerCase()).not.toMatch(/ilike|lower/);
  });

  it("escapes LIKE wildcards in contains and startsWith patterns", () => {
    const contains = sqlOf({ op: "contains", field: "name", value: "a%b_c" });
    const containsPattern = contains.params.find(
      (param) => typeof param === "string" && param.includes("a"),
    ) as string;
    expect(containsPattern).toBe("%a!%b!_c%");
    expect(contains.sql.toLowerCase()).toContain("escape '!'");
    expect(contains.sql).not.toContain("escape '\\'");

    const startsWith = sqlOf({
      op: "startsWith",
      field: "name",
      value: "a%b_c",
    });
    const startsWithPattern = startsWith.params.find(
      (param) => typeof param === "string" && param.includes("a"),
    );
    expect(startsWithPattern).toBe("a!%b!_c%");
  });

  it("escapes the LIKE escape character in patterns", () => {
    const { params } = sqlOf({
      op: "contains",
      field: "name",
      value: "a!b",
    });
    expect(params).toContain("%a!!b%");
  });

  it("throws for an opaque Prisma where node", () => {
    expect(() =>
      compileFilterToDrizzle(
        users,
        { author: { is: { tenantId: 1 } } } as never,
        { caseInsensitiveSearch: false, dialect: "sqlite" },
      ),
    ).toThrow(
      "nested Prisma `where` is not supported by the Drizzle adapter; return a Filter or a flat `{ field: scalar }` map",
    );
  });

  it("throws for an unknown field", () => {
    expect(() =>
      compileFilterToDrizzle(
        users,
        { op: "eq", field: "nope", value: 1 },
        { caseInsensitiveSearch: false, dialect: "sqlite" },
      ),
    ).toThrow("[sveltekit-admin] unknown field 'nope' on Drizzle table");
  });

  it("compiles composite filters", () => {
    expect(
      sqlOf({
        op: "and",
        clauses: [
          { op: "eq", field: "id", value: 1 },
          { op: "eq", field: "tenantId", value: 2 },
        ],
      }).sql.toLowerCase(),
    ).toContain("and");
    expect(
      sqlOf({
        op: "or",
        clauses: [
          { op: "eq", field: "id", value: 1 },
          { op: "eq", field: "id", value: 2 },
        ],
      }).sql.toLowerCase(),
    ).toContain("or");
  });

  it("compiles the remaining leaf operators", () => {
    expect(sqlOf({ op: "in", field: "id", value: [1, 2] }).params).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(sqlOf({ op: "isNull", field: "name" }).sql.toLowerCase()).toMatch(
      /is null/,
    );
    expect(sqlOf({ op: "isNotNull", field: "name" }).sql.toLowerCase()).toMatch(
      /is not null/,
    );
    expect(sqlOf({ op: "gte", field: "id", value: 3 }).sql).toContain(">=");
    expect(sqlOf({ op: "lte", field: "id", value: 3 }).sql).toContain("<=");
    expect(sqlOf({ op: "lt", field: "id", value: 3 }).sql).toContain("<");
  });
});
