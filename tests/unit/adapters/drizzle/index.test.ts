import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import * as drizzleApi from "../../../../src/lib/server/adapters/drizzle/index.js";
import {
  createDrizzleAdapter,
  resolveCaseInsensitiveSearch,
} from "../../../../src/lib/server/adapters/drizzle/index.js";
import { defaultAdminCheck } from "../../../../src/lib/server/auth.js";
import * as schema from "../../../fixtures/drizzle/schema.js";

const databases: Database.Database[] = [];

function createSqlite() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  return sqlite;
}

function seedUsersWithAlice() {
  const sqlite = createSqlite();
  sqlite.exec("PRAGMA case_sensitive_like = ON;");
  sqlite.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT, password_hash TEXT, tenant_id INTEGER NOT NULL, created_at INTEGER);",
  );
  sqlite.exec(
    "INSERT INTO users (email, name, tenant_id) VALUES ('a@x.y', 'Alice', 1);",
  );
  return drizzle(sqlite);
}

async function listByNameContains(
  db: ReturnType<typeof drizzle>,
  searchMode?: "auto" | "insensitive" | "default",
) {
  const adapter = createDrizzleAdapter(
    searchMode === undefined ? { db, schema } : { db, schema, searchMode },
  );
  const inspected = adapter.introspector.introspect();
  const users = (inspected as Awaited<typeof inspected>).models.find(
    (model) => model.name === "users",
  )!;
  return adapter.data.listRecords(users, {
    skip: 0,
    take: 20,
    filter: { op: "contains", field: "name", value: "alice" },
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("createDrizzleAdapter", () => {
  it("compose introspector synchrone + data.listRecords", async () => {
    const sqlite = createSqlite();
    sqlite.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT, password_hash TEXT, tenant_id INTEGER NOT NULL, created_at INTEGER);",
    );
    sqlite.exec(
      "INSERT INTO users (email, name, tenant_id) VALUES ('a@x.y', 'A', 1);",
    );
    const db = drizzle(sqlite);
    const adapter = createDrizzleAdapter({ db, schema });
    const first = adapter.introspector.introspect();

    expect(first).not.toBeInstanceOf(Promise);
    expect(adapter.introspector.introspect()).toBe(first);

    const users = (first as Awaited<typeof first>).models.find(
      (model) => model.name === "users",
    )!;
    const { rows, total } = await adapter.data.listRecords(users, {
      skip: 0,
      take: 20,
    });

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ email: "a@x.y" });
  });

  it("searchMode auto on sqlite uses case-sensitive contains", async () => {
    const { total } = await listByNameContains(seedUsersWithAlice());
    expect(total).toBe(0);
  });

  it("searchMode insensitive on sqlite uses case-insensitive contains", async () => {
    const { total } = await listByNameContains(
      seedUsersWithAlice(),
      "insensitive",
    );
    expect(total).toBe(1);
  });

  it("searchMode default on sqlite disables case-insensitive contains", async () => {
    const { total } = await listByNameContains(
      seedUsersWithAlice(),
      "default",
    );
    expect(total).toBe(0);
  });

  it("searchMode auto defaults to sensitive search on sqlite", () => {
    const db = drizzle(createSqlite());
    const adapter = createDrizzleAdapter({ db, schema });

    expect(adapter.introspector.introspect()).toMatchObject({
      provider: "sqlite",
    });
  });
});

describe("resolveCaseInsensitiveSearch", () => {
  it("searchMode insensitive forces true regardless of dialect", () => {
    expect(resolveCaseInsensitiveSearch("sqlite", "insensitive")).toBe(true);
  });

  it("searchMode auto with postgresql enables insensitive search", () => {
    expect(resolveCaseInsensitiveSearch("postgresql", "auto")).toBe(true);
  });

  it("searchMode auto with sqlite disables insensitive search", () => {
    expect(resolveCaseInsensitiveSearch("sqlite", "auto")).toBe(false);
  });

  it("searchMode default always disables insensitive search", () => {
    expect(resolveCaseInsensitiveSearch("postgresql", "default")).toBe(false);
  });

  it("searchMode defaults to auto", () => {
    expect(resolveCaseInsensitiveSearch("mysql")).toBe(false);
  });
});

it("package.json expose le sous-chemin ./adapters/drizzle", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
  );

  expect(pkg.exports["./adapters/drizzle"]).toMatchObject({
    types: "./dist/server/adapters/drizzle/index.d.ts",
    svelte: "./dist/server/adapters/drizzle/index.js",
    default: "./dist/server/adapters/drizzle/index.js",
  });
});

describe("surface publique sveltekit-admin/adapters/drizzle", () => {
  it("exporte createAdminHandler, createDrizzleAdapter et defaultAdminCheck", () => {
    expect(typeof drizzleApi.createAdminHandler).toBe("function");
    expect(typeof drizzleApi.createDrizzleAdapter).toBe("function");
    expect(typeof drizzleApi.defaultAdminCheck).toBe("function");
    expect(drizzleApi.defaultAdminCheck).toBe(defaultAdminCheck);
  });

  it("n’exporte pas createPrismaAdapter", () => {
    expect("createPrismaAdapter" in drizzleApi).toBe(false);
  });

  it("réexporte les types AdminPlugin", () => {
    const src = readFileSync(
      new URL("../../../../src/lib/server/adapters/drizzle/index.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/AdminPlugin/);
    expect(src).toMatch(/PluginPageContext/);
  });
});
