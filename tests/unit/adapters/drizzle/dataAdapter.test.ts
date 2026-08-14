import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleDataAdapter } from "../../../../src/lib/server/adapters/drizzle/dataAdapter.js";
import { inspectDrizzleSchema } from "../../../../src/lib/server/adapters/drizzle/inspect.js";
import { buildRelationGraph } from "../../../../src/lib/server/introspection/relations.js";
import type { Model } from "../../../../src/lib/server/types/schema.js";
import * as full from "../../../fixtures/drizzle/schema.js";

const inspected = inspectDrizzleSchema(full);
const users = inspected.schema.models.find((model) => model.name === "users")!;
const posts = inspected.schema.models.find((model) => model.name === "posts")!;
const tags = inspected.schema.models.find((model) => model.name === "tags")!;
const tagsEdge = buildRelationGraph(inspected.schema).edges.get("posts.tags")!;

describe("createDrizzleDataAdapter", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;
  let adapter: ReturnType<typeof createDrizzleDataAdapter>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        name TEXT,
        tenant_id INTEGER NOT NULL,
        created_at INTEGER
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author_id INTEGER NOT NULL
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE posts_to_tags (
        post_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (post_id, tag_id)
      );
    `);
    db = drizzle(sqlite);
    adapter = createDrizzleDataAdapter(db, {
      tables: inspected.tables,
      m2m: inspected.m2m,
      dialect: inspected.dialect,
      caseInsensitiveSearch: false,
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  const seedUsers = () => {
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("one@example.com", "Charlie", 1);
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("two@example.com", "Alice", 2);
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("three@example.com", "Bob", 1);
  };

  const seedPostRelations = () => {
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("author@example.com", "Author", 1);
    sqlite.prepare("INSERT INTO tags (name) VALUES (?)").run("first");
    sqlite.prepare("INSERT INTO tags (name) VALUES (?)").run("second");
  };

  it("lists matching rows by descending PK with pagination and total count", async () => {
    seedUsers();

    const result = await adapter.listRecords(users, { skip: 1, take: 1 });

    expect(result).toEqual({
      rows: [
        {
          id: 2,
          email: "two@example.com",
          name: "Alice",
          tenantId: 2,
          createdAt: null,
        },
      ],
      total: 3,
    });
  });

  it("filters list rows and total through the Drizzle filter compiler", async () => {
    seedUsers();

    const result = await adapter.listRecords(users, {
      filter: { op: "eq", field: "tenantId", value: 1 },
      skip: 0,
      take: 10,
    });

    expect(result.rows.map((row) => row.id)).toEqual([3, 1]);
    expect(result.total).toBe(2);
  });

  it("gets one record, finds the first match, and counts filtered records", async () => {
    seedUsers();

    expect(await adapter.getRecord(users, "2")).toMatchObject({
      id: 2,
      name: "Alice",
    });
    expect(await adapter.getRecord(users, "99")).toBeNull();
    expect(
      await adapter.findFirst(users, {
        op: "eq",
        field: "email",
        value: "three@example.com",
      }),
    ).toMatchObject({ id: 3, name: "Bob" });
    expect(
      await adapter.findFirst(users, {
        op: "eq",
        field: "email",
        value: "missing@example.com",
      }),
    ).toBeNull();
    expect(
      await adapter.countRecords(users, {
        op: "eq",
        field: "tenantId",
        value: 1,
      }),
    ).toBe(2);
    expect(await adapter.countRecords(users)).toBe(3);
  });

  it("finds many records with ordering and optional pagination", async () => {
    seedUsers();

    const all = await adapter.findMany(users, { orderBy: { name: "asc" } });
    const descending = await adapter.findMany(users, {
      orderBy: { name: "desc" },
    });
    const unordered = await adapter.findMany(users, {});
    const page = await adapter.findMany(users, {
      orderBy: { name: "asc" },
      skip: 1,
      take: 1,
    });

    expect(all.map((row) => row.name)).toEqual(["Alice", "Bob", "Charlie"]);
    expect(descending.map((row) => row.name)).toEqual([
      "Charlie",
      "Bob",
      "Alice",
    ]);
    expect(unordered).toHaveLength(3);
    expect(page.map((row) => row.name)).toEqual(["Bob"]);
  });

  it("throws for an unknown orderBy field", async () => {
    await expect(
      adapter.findMany(users, { orderBy: { missing: "asc" } }),
    ).rejects.toThrow(/unknown field 'missing'/);
  });

  it("creates scalar records without opening a transaction", async () => {
    const transaction = db.transaction;
    db.transaction = (() => {
      throw new Error("unexpected transaction");
    }) as typeof db.transaction;

    const row = await adapter.createRecord(users, {
      scalars: { email: "new@example.com", name: "New", tenantId: 4 },
    });

    expect(row).toMatchObject({ id: 1, email: "new@example.com", tenantId: 4 });
    db.transaction = transaction;
  });

  it("updates and deletes scalar records", async () => {
    seedUsers();

    const updated = await adapter.updateRecord(users, "2", {
      scalars: { name: "Updated" },
    });
    expect(updated).toMatchObject({ id: 2, name: "Updated" });

    await adapter.deleteRecord(users, "2");
    expect(await adapter.getRecord(users, 2)).toBeNull();
  });

  it("creates a record and inserts its m2m pivot rows", async () => {
    seedPostRelations();

    const post = await adapter.createRecord(posts, {
      scalars: { title: "With tags", authorId: 1 },
      m2m: { tags: { targetPkField: "id", ids: [1, 2] } },
    });

    expect(post).toMatchObject({ id: 1, title: "With tags", authorId: 1 });
    expect(
      sqlite
        .prepare("SELECT post_id, tag_id FROM posts_to_tags ORDER BY tag_id")
        .all(),
    ).toEqual([
      { post_id: 1, tag_id: 1 },
      { post_id: 1, tag_id: 2 },
    ]);
  });

  it("replaces existing m2m rows during update", async () => {
    seedPostRelations();
    sqlite
      .prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)")
      .run("Original", 1);
    sqlite
      .prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)")
      .run(1, 1);

    const post = await adapter.updateRecord(posts, 1, {
      scalars: { title: "Updated" },
      m2m: { tags: { targetPkField: "id", ids: [2] } },
    });

    expect(post).toMatchObject({ id: 1, title: "Updated" });
    expect(
      sqlite.prepare("SELECT post_id, tag_id FROM posts_to_tags").all(),
    ).toEqual([{ post_id: 1, tag_id: 2 }]);
  });

  it("detaches all m2m rows when update receives an empty id list", async () => {
    seedPostRelations();
    sqlite
      .prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)")
      .run("Original", 1);
    sqlite
      .prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)")
      .run(1, 1);

    await adapter.updateRecord(posts, "1", {
      scalars: { title: "No tags" },
      m2m: { tags: { targetPkField: "id", ids: [] } },
    });

    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toEqual([]);
  });

  it("returns selected m2m target ids and an empty list for an unknown link", async () => {
    seedPostRelations();
    sqlite
      .prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)")
      .run("Original", 1);
    sqlite
      .prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)")
      .run(1, 2);

    expect(await adapter.getM2mSelectedIds(posts, tagsEdge, tags, "1")).toEqual(
      [2],
    );
    const unknownEdge = { ...tagsEdge, field: "missing" };
    expect(
      await adapter.getM2mSelectedIds(posts, unknownEdge, tags, 1),
    ).toEqual([]);
  });

  it("skips m2m fields without an inspected pivot link", async () => {
    seedPostRelations();

    const created = await adapter.createRecord(posts, {
      scalars: { title: "Unknown relation", authorId: 1 },
      m2m: { missing: { targetPkField: "id", ids: [1] } },
    });
    const updated = await adapter.updateRecord(posts, created.id as number, {
      scalars: { title: "Still valid" },
      m2m: { missing: { targetPkField: "id", ids: [2] } },
    });

    expect(updated.title).toBe("Still valid");
    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toEqual([]);
  });

  it("throws when the model has no inspected Drizzle table", async () => {
    const unknown: Model = { ...users, name: "missing" };
    await expect(adapter.countRecords(unknown)).rejects.toThrow(
      /missing Drizzle table 'missing'/,
    );
  });

  it("uses MySQL returning ids followed by a primary-key select", async () => {
    const returned = { id: 7, email: "mysql@example.com", tenantId: 9 };
    const selected = {
      limit: async () => [returned],
      then: (resolve: (rows: (typeof returned)[]) => void) =>
        resolve([returned]),
    };
    const fakeDb = {
      insert: () => ({
        values: () => ({
          $returningId: async () => [{ id: 7 }],
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => selected,
        }),
      }),
    };
    const mysqlAdapter = createDrizzleDataAdapter(fakeDb, {
      tables: inspected.tables,
      m2m: inspected.m2m,
      dialect: "mysql",
      caseInsensitiveSearch: false,
    });

    await expect(
      mysqlAdapter.createRecord(users, {
        scalars: { email: "mysql@example.com", tenantId: 9 },
      }),
    ).resolves.toBe(returned);
    await expect(
      mysqlAdapter.updateRecord(users, 7, {
        scalars: { email: "updated@example.com" },
      }),
    ).resolves.toBe(returned);
  });

  it("performs async-dialect m2m writes in transactions", async () => {
    const returned = { id: 7, title: "Network post", authorId: 1 };
    const insertedValues: unknown[] = [];
    const selected = {
      limit: async () => [returned],
      then: (resolve: (rows: (typeof returned)[]) => void) =>
        resolve([returned]),
    };
    const fakeDb: any = {
      insert: () => ({
        values: (values: unknown) => {
          insertedValues.push(values);
          return { $returningId: async () => [{ id: 7 }] };
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
      delete: () => ({
        where: async () => undefined,
      }),
      select: () => ({
        from: () => ({
          where: () => selected,
        }),
      }),
      transaction: (callback: (tx: any) => Promise<unknown>) =>
        callback(fakeDb),
    };
    const mysqlAdapter = createDrizzleDataAdapter(fakeDb, {
      tables: inspected.tables,
      m2m: inspected.m2m,
      dialect: "mysql",
      caseInsensitiveSearch: false,
    });

    await mysqlAdapter.createRecord(posts, {
      scalars: { title: "Network post", authorId: 1 },
      m2m: {
        tags: { targetPkField: "id", ids: [] },
        missing: { targetPkField: "id", ids: [1] },
      },
    });
    await mysqlAdapter.updateRecord(posts, 7, {
      scalars: { title: "Updated network post" },
      m2m: {
        tags: { targetPkField: "id", ids: [2] },
        missing: { targetPkField: "id", ids: [1] },
      },
    });
    await mysqlAdapter.deleteRecord(posts, 7);
    await mysqlAdapter.deleteRecord(users, 7);

    expect(insertedValues).toContainEqual([{ postId: 7, tagId: 2 }]);
  });
});
