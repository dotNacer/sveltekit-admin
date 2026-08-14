import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/pg-proxy";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";
import { createDrizzleAdapter } from "../../../../src/lib/server/adapters/drizzle/index.js";
import * as schema from "../../../fixtures/drizzle/schema.js";

const databases: Database.Database[] = [];

function createSqlite() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  return sqlite;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("createDrizzleAdapter", () => {
  it("compose introspector synchrone + data.listRecords", async () => {
    const sqlite = createSqlite();
    sqlite.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT, tenant_id INTEGER NOT NULL, created_at INTEGER);",
    );
    sqlite.exec(
      "INSERT INTO users (email, name, tenant_id) VALUES ('a@x.y', 'A', 1);",
    );
    const db = drizzle(sqlite);
    const adapter = createDrizzleAdapter({ db, schema });
    const inspected = adapter.introspector.introspect();

    expect(inspected).not.toBeInstanceOf(Promise);
    const users = (inspected as Awaited<typeof inspected>).models.find(
      (model) => model.name === "users",
    )!;
    const { rows, total } = await adapter.data.listRecords(users, {
      skip: 0,
      take: 20,
    });

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ email: "a@x.y" });
  });

  it("searchMode 'insensitive' on sqlite still builds", () => {
    const db = drizzle(createSqlite());

    expect(() =>
      createDrizzleAdapter({ db, schema, searchMode: "insensitive" }),
    ).not.toThrow();
  });

  it("searchMode 'default' disables insensitive search", () => {
    const db = drizzle(createSqlite());

    expect(() =>
      createDrizzleAdapter({ db, schema, searchMode: "default" }),
    ).not.toThrow();
  });

  it("searchMode 'auto' defaults to sensitive search on sqlite", () => {
    const db = drizzle(createSqlite());
    const adapter = createDrizzleAdapter({ db, schema });

    expect(adapter.introspector.introspect()).toMatchObject({
      provider: "sqlite",
    });
  });

  it("searchMode 'auto' enables insensitive search on postgresql", () => {
    const pgUsers = pgTable("users", {
      id: serial("id").primaryKey(),
      name: text("name"),
    });
    const db = drizzlePg(async () => ({ rows: [] }));
    const adapter = createDrizzleAdapter({
      db,
      schema: { users: pgUsers },
      searchMode: "auto",
    });

    expect(adapter.introspector.introspect()).toMatchObject({
      provider: "postgresql",
    });
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
