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
        password_hash TEXT,
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

  it("sorts on the requested column, ascending", async () => {
    seedUsers();

    const result = await adapter.listRecords(users, {
      skip: 0,
      take: 10,
      orderBy: { field: "name", dir: "asc" },
    });

    expect(result.rows.map((row) => row.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sorts on the requested column, descending", async () => {
    seedUsers();

    const result = await adapter.listRecords(users, {
      skip: 0,
      take: 10,
      orderBy: { field: "name", dir: "desc" },
    });

    expect(result.rows.map((row) => row.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("breaks ties on the primary key so pagination stays stable", async () => {
    // Trois lignes de même `name` : sans départage, l'ordre entre elles est à
    // la main du moteur, et deux fenêtres skip/take successives peuvent voir
    // la même ligne deux fois.
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("a@example.com", "Same", 1);
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("b@example.com", "Same", 1);
    sqlite
      .prepare("INSERT INTO users (email, name, tenant_id) VALUES (?, ?, ?)")
      .run("c@example.com", "Same", 1);

    const result = await adapter.listRecords(users, {
      skip: 0,
      take: 10,
      orderBy: { field: "name", dir: "asc" },
    });

    expect(result.rows.map((row) => row.id)).toEqual([3, 2, 1]);
  });

  it("sorts on the primary key without adding a second key", async () => {
    // Le départage est la clé primaire elle-même : l'ajouter deux fois n'aurait
    // pas de sens. Seul l'ordre demandé s'applique.
    seedUsers();

    const result = await adapter.listRecords(users, {
      skip: 0,
      take: 10,
      orderBy: { field: "id", dir: "asc" },
    });

    expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("deletes several rows at once and returns the count", async () => {
    seedUsers();

    expect(await adapter.deleteMany(users, [1, 3])).toBe(2);

    const remaining = await adapter.listRecords(users, { skip: 0, take: 10 });
    expect(remaining.rows.map((row) => row.id)).toEqual([2]);
  });

  it("only deletes rows the authorization filter matches", async () => {
    // L'id hors portée ne matche pas : rien n'est supprimé pour lui, et rien
    // n'est levé — donc rien ne dit s'il existe ailleurs.
    seedUsers();

    const deleted = await adapter.deleteMany(users, [1, 2, 3], {
      op: "eq",
      field: "tenantId",
      value: 1,
    });

    expect(deleted).toBe(2);
    const remaining = await adapter.listRecords(users, { skip: 0, take: 10 });
    expect(remaining.rows.map((row) => row.id)).toEqual([2]);
  });

  it("deletes nothing when no id matches", async () => {
    seedUsers();

    expect(await adapter.deleteMany(users, [99])).toBe(0);
  });

  it("clears m2m pivot rows for the rows it deletes, and only those", async () => {
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("Gone", 1);
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("Kept", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(2, 2);

    expect(await adapter.deleteMany(posts, [1])).toBe(1);

    expect(sqlite.prepare("SELECT post_id FROM posts_to_tags").all()).toEqual([
      { post_id: 2 },
    ]);
  });

  it("leaves the pivot rows of an out-of-scope row untouched", async () => {
    // Le piège : composer la portée dans le DELETE des pivots effacerait les
    // liaisons d'une ligne que le DELETE du parent ne touche pas — une ligne
    // d'un autre tenant amputée de ses relations, sans trace.
    seedUsers();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("Theirs", 2);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);

    expect(
      await adapter.deleteMany(posts, [1], { op: "eq", field: "authorId", value: 1 }),
    ).toBe(0);

    expect(sqlite.prepare("SELECT post_id FROM posts_to_tags").all()).toEqual([
      { post_id: 1 },
    ]);
  });

  it("rejects a column the table does not have", async () => {
    seedUsers();

    await expect(
      adapter.listRecords(users, { skip: 0, take: 10, orderBy: { field: "nope", dir: "asc" } }),
    ).rejects.toThrow(/unknown field/);
  });

  it("lists matching rows by descending PK with pagination and total count", async () => {
    seedUsers();

    const result = await adapter.listRecords(users, { skip: 1, take: 1 });

    expect(result).toEqual({
      rows: [
        {
          id: 2,
          email: "two@example.com",
          name: "Alice",
          // La colonne sensible du schéma de fixture : ce test porte sur la
          // forme brute de la ligne sélectionnée, donc elle y figure. Les
          // règles de formulaire/écriture qui la concernent vivent plus haut
          // (`Form.svelte`, `mutations.ts`), pas dans l'adaptateur.
          passwordHash: null,
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

  it("valide les guards de cibles dans la transaction", async () => {
    seedPostRelations();
    const guard = { targetModel: users, targetPk: 1, filter: { op: "eq" as const, field: "tenantId", value: 1 } };
    await adapter.createRecord(posts, { scalars: { title: "guarded", authorId: 1 }, targetGuards: [guard] });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get()).toEqual({ n: 1 });
  });

  it("refuse une cible Drizzle hors scope avant l’écriture", async () => {
    seedPostRelations();
    await expect(adapter.createRecord(posts, { scalars: { title: "blocked", authorId: 1 }, targetGuards: [{ targetModel: users, targetPk: 1, filter: { op: "eq", field: "tenantId", value: 2 } }] })).rejects.toThrow(/outside/);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get()).toEqual({ n: 0 });
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

  it("deletes scalar records without opening a transaction", async () => {
    seedUsers();
    const transaction = db.transaction;
    db.transaction = (() => {
      throw new Error("unexpected transaction");
    }) as typeof db.transaction;

    await adapter.deleteRecord(users, "2");

    expect(await adapter.getRecord(users, 2)).toBeNull();
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

  it("fails closed when an authorized update affects no row", async () => {
    seedUsers();
    await expect(
      adapter.updateRecord(users, 2, { scalars: { name: "nope" } }, { op: "eq", field: "tenantId", value: 1 }),
    ).rejects.toThrow(/outside the authorization scope/);
  });

  it("does not delete m2m pivots when the scoped parent is absent", async () => {
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("post", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);
    await expect(adapter.deleteRecord(posts, 1, { op: "eq", field: "id", value: 999 })).rejects.toThrow(/outside/);
    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toHaveLength(1);
  });

  it("supprime les pivots puis le parent SQLite", async () => {
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("post", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);
    await adapter.deleteRecord(posts, 1);
    expect(sqlite.prepare("SELECT * FROM posts").all()).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toHaveLength(0);
  });

  it("supprime un parent async MySQL avec une ligne affectée", async () => {
    const query = { limit: async () => [{ id: 7 }], then: (resolve: (rows: unknown[]) => void) => resolve([{ id: 7 }]) };
    const fakeDb: any = { select: () => ({ from: () => ({ where: () => query }) }), delete: () => ({ where: async () => ({ affectedRows: 1 }) }), transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb) };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await mysql.deleteRecord(posts, 7);
  });

  it("supprime en masse sur un dialecte async, pivots compris", async () => {
    const deleted: unknown[] = [];
    const fakeDb: any = {
      select: () => ({ from: () => ({ where: async () => [{ id: 7 }, { id: 8 }] }) }),
      delete: (table: unknown) => ({ where: async () => { deleted.push(table); } }),
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb)
    };
    const pg = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });

    expect(await pg.deleteMany(posts, [7, 8])).toBe(2);
    // Un DELETE pour le pivot, un pour le parent.
    expect(deleted).toHaveLength(2);
  });

  it("ne supprime rien sur un dialecte async quand aucun id ne matche", async () => {
    const fakeDb: any = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => { throw new Error("ne doit pas être appelé"); } }),
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb)
    };
    const pg = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });

    expect(await pg.deleteMany(posts, [99])).toBe(0);
  });

  it("fails closed on missing MySQL and async-dialect updates", async () => {
    const empty = { limit: async () => [], then: (resolve: (rows: unknown[]) => void) => resolve([]) };
    const makeDb = (returning: unknown[] | undefined, mysql: boolean) => ({
      update: () => ({
        set: () => ({
          where: () => mysql ? undefined : { returning: async () => returning ?? [] },
        }),
      }),
      select: () => ({ from: () => ({ where: () => empty }) }),
    });
    const mysql = createDrizzleDataAdapter(makeDb(undefined, true), { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysql.updateRecord(users, 7, { scalars: {} }, { op: "eq", field: "tenantId", value: 1 })).rejects.toThrow(/outside/);
    const pg = createDrizzleDataAdapter(makeDb([], false), { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });
    await expect(pg.updateRecord(users, 7, { scalars: {} }, { op: "eq", field: "tenantId", value: 1 })).rejects.toThrow(/outside/);
  });

  it("fails closed when a scoped SQLite m2m update affects no row", async () => {
    seedPostRelations();
    await expect(
      adapter.updateRecord(posts, 999, { scalars: { title: "nope" }, m2m: { tags: { targetPkField: "id", ids: [] } } }, { op: "eq", field: "id", value: 1 }),
    ).rejects.toThrow(/outside the authorization scope/);
  });

  it("aborts the async m2m transaction when the scoped parent delete affects no row", async () => {
    // Les pivots sont bien supprimés en premier (ordre imposé par les FK) : la
    // garantie n'est pas qu'on ne les touche pas, c'est que le throw remonte
    // hors du callback de transaction et que le driver annule tout.
    let deleteCalls = 0;
    let committed = true;
    const emptyDb: any = {
      delete: () => ({ where: async () => { deleteCalls += 1; return { affectedRows: 0 }; } }),
      transaction: async (callback: (tx: any) => unknown) => {
        try {
          return await callback(emptyDb);
        } catch (error) {
          committed = false;
          throw error;
        }
      },
    };
    const mysqlAdapter = createDrizzleDataAdapter(emptyDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysqlAdapter.deleteRecord(posts, 7, { op: "eq", field: "id", value: 1 })).rejects.toThrow(/outside/);
    expect(deleteCalls).toBe(2);
    expect(committed).toBe(false);
  });

  it("rejoue une transaction d'écriture annulée pour conflit de sérialisation", async () => {
    // Le moteur annule entièrement la transaction avant de renvoyer 40001 :
    // rien n'a été écrit, rejouer est sûr et évite un 500 gratuit.
    let attempts = 0;
    const row = { id: 7, title: "ok", authorId: 1 };
    const fakeDb: any = {
      insert: () => ({ values: () => ({ returning: async () => [row] }) }),
      transaction: async (callback: (tx: any) => Promise<unknown>) => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("could not serialize access"), { code: "40001" });
        return callback(fakeDb);
      },
    };
    const pg = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });

    await expect(
      pg.createRecord(posts, { scalars: { title: "ok", authorId: 1 }, m2m: { tags: { targetPkField: "id", ids: [] } } }),
    ).resolves.toEqual(row);
    expect(attempts).toBe(2);
  });

  it("ne rejoue pas un refus de scope", async () => {
    let attempts = 0;
    const fakeDb: any = {
      delete: () => ({ where: async () => ({ affectedRows: 0 }) }),
      transaction: async (callback: (tx: any) => Promise<unknown>) => {
        attempts += 1;
        return callback(fakeDb);
      },
    };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });

    await expect(mysql.deleteRecord(posts, 7, { op: "eq", field: "id", value: 1 })).rejects.toThrow(/outside/);
    expect(attempts).toBe(1);
  });

  it("verrouille les lignes de guard en FOR SHARE sur PostgreSQL uniquement", async () => {
    const strengths: string[] = [];
    const makeDb = (): any => {
      const query: any = {
        limit: () => query,
        for: (strength: string) => { strengths.push(strength); return query; },
        then: (resolve: (rows: unknown[]) => void) => resolve([{ id: 1 }]),
      };
      const db: any = {
        select: () => ({ from: () => ({ where: () => query }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 1 }] }) }) }),
        transaction: (callback: (tx: any) => Promise<unknown>) => callback(db),
      };
      return db;
    };
    const guard = { targetModel: users, targetPk: 1, filter: { op: "eq" as const, field: "tenantId", value: 1 } };

    const pg = createDrizzleDataAdapter(makeDb(), { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });
    await pg.updateRecord(users, 1, { scalars: { name: "ok" }, targetGuards: [guard] });
    expect(strengths).toEqual(["share"]);

    // MySQL ferme déjà la fenêtre via SERIALIZABLE, et `for share` y est une
    // syntaxe 8.0+ : on ne doit pas l'émettre.
    strengths.length = 0;
    const mysqlDb = makeDb();
    mysqlDb.update = () => ({ set: () => ({ where: async () => undefined }) });
    mysqlDb.select = () => ({ from: () => ({ where: () => ({ limit: () => ({ then: (r: (rows: unknown[]) => void) => r([{ id: 1 }]) }) }) }) });
    const mysql = createDrizzleDataAdapter(mysqlDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await mysql.updateRecord(users, 1, { scalars: { name: "ok" }, targetGuards: [guard] });
    expect(strengths).toEqual([]);
  });

  it("verrouille les guards dans un ordre deterministe quel que soit l'ordre soumis", async () => {
    // Sans tri, l'ordre vient des ids du formulaire : deux requetes envoyant
    // [3,1,2] et [2,3,1] verrouilleraient les memes lignes en sens inverse et
    // pourraient se deadlocker.
    seedPostRelations();
    sqlite.prepare("INSERT INTO tags (name) VALUES (?)").run("third");

    const pkOrder = async (submitted: Array<string | number>) => {
      const queries: Array<[string, unknown[]]> = [];
      const logged = drizzle(sqlite, {
        logger: { logQuery: (query: string, params: unknown[]) => { queries.push([query, params]); } },
      });
      const logging = createDrizzleDataAdapter(logged, {
        tables: inspected.tables,
        m2m: inspected.m2m,
        dialect: inspected.dialect,
        caseInsensitiveSearch: false,
      });
      await logging.createRecord(posts, {
        scalars: { title: "t", authorId: 1 },
        targetGuards: submitted.map((pk) => ({ targetModel: tags, targetPk: pk })),
      });
      // Chaque guard émet un `select ... from "tags" where id = ? limit ?`.
      return queries
        .filter(([query]) => query.startsWith("select") && query.includes('from "tags"'))
        .map(([, params]) => params[0]);
    };

    expect(await pkOrder([3, 1, 2])).toEqual([1, 2, 3]);
    expect(await pkOrder([2, 3, 1])).toEqual([1, 2, 3]);
  });

  it("fails closed when a MySQL m2m parent delete returns no result-set header", async () => {
    // mysql2 renvoie un ResultSetHeader ; un pilote qui renvoie autre chose ne
    // doit pas être lu comme « une ligne supprimée ».
    let calls = 0;
    const fakeDb: any = {
      delete: () => ({ where: async () => { calls += 1; return calls === 1 ? { affectedRows: 1 } : []; } }),
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb),
    };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysql.deleteRecord(posts, 7)).rejects.toThrow(/outside the authorization scope/);
  });

  it("fails closed on an out-of-scope SQLite delete without pivots", async () => {
    seedUsers();

    await expect(
      adapter.deleteRecord(users, 1, { op: "eq", field: "tenantId", value: 2 }),
    ).rejects.toThrow(/outside the authorization scope/);
    expect(sqlite.prepare("SELECT * FROM users WHERE id = 1").all()).toHaveLength(1);
  });

  it("rolls the pivots back when an out-of-scope SQLite parent delete affects no row", async () => {
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("post", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);

    await expect(
      adapter.deleteRecord(posts, 1, { op: "eq", field: "id", value: 999 }),
    ).rejects.toThrow(/outside the authorization scope/);

    // Le rollback est réel, pas simulé : les pivots supprimés dans la
    // transaction sont revenus.
    expect(sqlite.prepare("SELECT * FROM posts").all()).toHaveLength(1);
    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toHaveLength(1);
  });

  it("rolls the pivots back when a RESTRICT foreign key blocks the parent delete", async () => {
    sqlite.exec(`
      DROP TABLE posts_to_tags;
      DROP TABLE posts;
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author_id INTEGER NOT NULL
      );
      CREATE TABLE posts_to_tags (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
        PRIMARY KEY (post_id, tag_id)
      );
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE RESTRICT
      );
    `);
    sqlite.pragma("foreign_keys = ON");
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("post", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);
    sqlite.prepare("INSERT INTO comments (post_id) VALUES (?)").run(1);

    // `comments` n'est pas un pivot m2m : l'adapter ne le nettoie pas, donc le
    // DELETE du parent viole la contrainte RESTRICT.
    await expect(adapter.deleteRecord(posts, 1)).rejects.toThrow();

    expect(sqlite.prepare("SELECT * FROM posts").all()).toHaveLength(1);
    expect(sqlite.prepare("SELECT * FROM posts_to_tags").all()).toHaveLength(1);
    expect(sqlite.prepare("SELECT * FROM comments").all()).toHaveLength(1);
  });

  it("valide un guard dans une transaction async", async () => {
    const row = { id: 1, email: "guard@example.com", tenantId: 1 };
    const query = { limit: async () => [row], then: (resolve: (rows: unknown[]) => void) => resolve([row]) };
    const fakeDb: any = {
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      select: () => ({ from: () => ({ where: () => query }) }),
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb),
    };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysql.updateRecord(users, 1, { scalars: { name: "ok" }, targetGuards: [{ targetModel: users, targetPk: 1, filter: { op: "eq", field: "tenantId", value: 1 } }] })).resolves.toEqual(row);
  });

  it("refuse un guard async hors scope", async () => {
    const query = { limit: async () => [], then: (resolve: (rows: unknown[]) => void) => resolve([]) };
    const fakeDb: any = { update: () => ({ set: () => ({ where: async () => undefined }) }), select: () => ({ from: () => ({ where: () => query }) }), transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb) };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysql.updateRecord(users, 1, { scalars: { name: "blocked" }, targetGuards: [{ targetModel: users, targetPk: 1, filter: { op: "eq", field: "tenantId", value: 1 } }] })).rejects.toThrow(/outside/);
  });

  it("échoue fermé si PostgreSQL ne supprime aucune ligne", async () => {
    const fakeDb: any = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 7 }] }) }) }), delete: () => ({ where: () => ({ returning: async () => [] }) }), transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb) };
    const pg = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });
    await expect(pg.deleteRecord(posts, 7)).rejects.toThrow(/outside/);
  });

  it("accepte le format mysql result-set header", async () => {
    const fakeDb: any = { delete: () => ({ where: async () => ({ affectedRows: 1 }) }), transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb) };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await mysql.deleteRecord(users, 1);
  });

  it("supprime les pivots après un delete parent réussi en async", async () => {
    let calls = 0;
    const fakeDb: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 7 }] }) }) }),
      delete: () => ({ where: async () => { calls += 1; return { affectedRows: 1 }; } }),
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb),
    };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await mysql.deleteRecord(posts, 7);
    expect(calls).toBe(2);
  });

  it("supprime les pivots après returning PostgreSQL", async () => {
    let deleteInvocations = 0;
    const fakeDb: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 7 }] }) }) }),
      delete: () => {
        deleteInvocations += 1;
        return deleteInvocations === 2
          ? { where: () => ({ returning: async () => [{ id: 7 }] }) }
          : { where: async () => undefined };
      },
      transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb),
    };
    const pg = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "postgresql", caseInsensitiveSearch: false });
    await pg.deleteRecord(posts, 7);
    expect(deleteInvocations).toBe(2);
  });

  it("échoue fermé avec un résultat mysql vide", async () => {
    const fakeDb: any = { delete: () => ({ where: async () => [] }), transaction: (callback: (tx: any) => Promise<unknown>) => callback(fakeDb) };
    const mysql = createDrizzleDataAdapter(fakeDb, { tables: inspected.tables, m2m: inspected.m2m, dialect: "mysql", caseInsensitiveSearch: false });
    await expect(mysql.deleteRecord(users, 1)).rejects.toThrow(/outside/);
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
        where: async () => ({ affectedRows: 1 }),
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
    }, { op: "eq", field: "id", value: 7 });
    await mysqlAdapter.deleteRecord(posts, 7, { op: "eq", field: "id", value: 7 });
    await mysqlAdapter.deleteRecord(users, 7);

    expect(insertedValues).toContainEqual([{ postId: 7, tagId: 2 }]);
  });

  it("applies an authorization filter to direct update and delete", async () => {
    seedUsers();
    await adapter.updateRecord(users, 1, { scalars: { name: "Scoped" } }, { op: "eq", field: "tenantId", value: 1 });
    await adapter.deleteRecord(users, 1, { op: "eq", field: "tenantId", value: 1 });
    expect(sqlite.prepare("SELECT id FROM users WHERE id = 1").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM users WHERE id = 2").get()).toMatchObject({ id: 2 });
  });

  it("applies authorization filters on m2m update and delete", async () => {
    seedPostRelations();
    sqlite.prepare("INSERT INTO posts (title, author_id) VALUES (?, ?)").run("Post", 1);
    sqlite.prepare("INSERT INTO posts_to_tags (post_id, tag_id) VALUES (?, ?)").run(1, 1);
    const auth = { op: "eq" as const, field: "id", value: 1 };
    await adapter.updateRecord(posts, 1, { scalars: { title: "Scoped" }, m2m: { tags: { targetPkField: "id", ids: [2] } } }, auth);
    expect(sqlite.prepare("SELECT title FROM posts WHERE id = 1").get()).toMatchObject({ title: "Scoped" });
    expect(sqlite.prepare("SELECT tag_id FROM posts_to_tags WHERE post_id = 1").get()).toMatchObject({ tag_id: 2 });
    await adapter.deleteRecord(posts, 1, auth);
    expect(sqlite.prepare("SELECT id FROM posts WHERE id = 1").get()).toBeUndefined();
  });
});
