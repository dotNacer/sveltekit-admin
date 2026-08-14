import { asc, count, desc, eq, getTableColumns } from "drizzle-orm";
import type { Column, Table } from "drizzle-orm";
import { coerceId, primaryKeyOf } from "../../data.js";
import type { Model } from "../../types/schema.js";
import type { DataAdapter, Filter } from "../types.js";
import { compileFilterToDrizzle } from "./filterCompiler.js";
import type { DrizzleDialect, M2mLink } from "./inspect.js";

interface DrizzleDataAdapterContext {
  tables: Record<string, Table>;
  m2m: Map<string, M2mLink>;
  dialect: DrizzleDialect;
  caseInsensitiveSearch: boolean;
}

function tableFor(ctx: DrizzleDataAdapterContext, model: Model): Table {
  const table = ctx.tables[model.name];
  if (!table) {
    throw new Error(`[sveltekit-admin] missing Drizzle table '${model.name}'`);
  }
  return table;
}

function primaryKeyColumn(table: Table, model: Model): Column {
  return (getTableColumns(table) as Record<string, Column>)[
    primaryKeyOf(model)
  ]!;
}

async function selectByPrimaryKey(
  db: any,
  table: Table,
  model: Model,
  id: string | number,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(table)
    .where(eq(primaryKeyColumn(table, model), coerceId(String(id), model)))
    .limit(1);
  return rows[0] ?? null;
}

async function insertAndReturn(
  db: any,
  table: Table,
  model: Model,
  scalars: Record<string, unknown>,
  dialect: DrizzleDialect,
): Promise<Record<string, unknown>> {
  if (dialect === "mysql") {
    const ids = await db.insert(table).values(scalars).$returningId();
    const primaryKey = primaryKeyOf(model);
    const rows = await db
      .select()
      .from(table)
      .where(eq(primaryKeyColumn(table, model), ids[0]![primaryKey]));
    return rows[0]!;
  }
  const rows = await db.insert(table).values(scalars).returning();
  return rows[0]!;
}

async function updateAndReturn(
  db: any,
  table: Table,
  model: Model,
  id: string | number,
  scalars: Record<string, unknown>,
  dialect: DrizzleDialect,
): Promise<Record<string, unknown>> {
  const coercedId = coerceId(String(id), model);
  const where = eq(primaryKeyColumn(table, model), coercedId);
  if (dialect === "mysql") {
    await db.update(table).set(scalars).where(where);
    return (await selectByPrimaryKey(db, table, model, coercedId))!;
  }
  const rows = await db.update(table).set(scalars).where(where).returning();
  return rows[0]!;
}

async function insertM2mRows(
  db: any,
  link: M2mLink,
  parentId: unknown,
  ids: Array<string | number>,
): Promise<void> {
  if (ids.length === 0) return;
  await db.insert(link.pivot).values(
    ids.map((id) => ({
      [link.selfKey]: parentId,
      [link.otherKey]: id,
    })),
  );
}

function insertAndReturnSqlite(
  db: any,
  table: Table,
  scalars: Record<string, unknown>,
): Record<string, unknown> {
  return db.insert(table).values(scalars).returning().get();
}

function updateAndReturnSqlite(
  db: any,
  table: Table,
  model: Model,
  id: string | number,
  scalars: Record<string, unknown>,
): Record<string, unknown> {
  return db
    .update(table)
    .set(scalars)
    .where(eq(primaryKeyColumn(table, model), coerceId(String(id), model)))
    .returning()
    .get();
}

function insertM2mRowsSqlite(
  db: any,
  link: M2mLink,
  parentId: unknown,
  ids: Array<string | number>,
): void {
  if (ids.length === 0) return;
  db.insert(link.pivot)
    .values(
      ids.map((id) => ({
        [link.selfKey]: parentId,
        [link.otherKey]: id,
      })),
    )
    .run();
}

export function createDrizzleDataAdapter(
  db: any,
  ctx: DrizzleDataAdapterContext,
): DataAdapter {
  const compileHere = (table: Table, filter: Filter | undefined) =>
    compileFilterToDrizzle(table, filter, {
      caseInsensitiveSearch: ctx.caseInsensitiveSearch,
      dialect: ctx.dialect,
    });

  return {
    async listRecords(model, opts) {
      const table = tableFor(ctx, model);
      const where = compileHere(table, opts.filter);
      const primaryKey = primaryKeyColumn(table, model);
      const [rows, totals] = await Promise.all([
        db
          .select()
          .from(table)
          .where(where)
          .orderBy(desc(primaryKey))
          .limit(opts.take)
          .offset(opts.skip),
        db.select({ n: count() }).from(table).where(where),
      ]);
      return { rows, total: totals[0]!.n };
    },

    async findMany(model, opts) {
      const table = tableFor(ctx, model);
      const columns = getTableColumns(table) as Record<string, Column>;
      const orderBy = Object.entries(opts.orderBy ?? {}).map(
        ([field, direction]) => {
          const column = columns[field];
          if (!column) {
            throw new Error(
              `[sveltekit-admin] unknown field '${field}' on Drizzle table`,
            );
          }
          return direction === "asc" ? asc(column) : desc(column);
        },
      );
      let query = db
        .select()
        .from(table)
        .where(compileHere(table, opts.filter));
      if (orderBy.length > 0) query = query.orderBy(...orderBy);
      if (opts.take !== undefined) query = query.limit(opts.take);
      if (opts.skip !== undefined) query = query.offset(opts.skip);
      return query;
    },

    async getRecord(model, id) {
      return selectByPrimaryKey(db, tableFor(ctx, model), model, id);
    },

    async findFirst(model, filter) {
      const table = tableFor(ctx, model);
      const rows = await db
        .select()
        .from(table)
        .where(compileHere(table, filter))
        .limit(1);
      return rows[0] ?? null;
    },

    async countRecords(model, filter) {
      const table = tableFor(ctx, model);
      const rows = await db
        .select({ n: count() })
        .from(table)
        .where(compileHere(table, filter));
      return rows[0]!.n;
    },

    async createRecord(model, input) {
      const table = tableFor(ctx, model);
      const m2mFields = Object.entries(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return insertAndReturn(db, table, model, input.scalars, ctx.dialect);
      }
      if (ctx.dialect === "sqlite") {
        return db.transaction((tx: any) => {
          const parent = insertAndReturnSqlite(tx, table, input.scalars);
          const parentId = parent[primaryKeyOf(model)];
          for (const [field, relation] of m2mFields) {
            const link = ctx.m2m.get(`${model.name}.${field}`);
            if (!link) continue;
            insertM2mRowsSqlite(tx, link, parentId, relation.ids);
          }
          return parent;
        });
      }
      return db.transaction(async (tx: any) => {
        const parent = await insertAndReturn(
          tx,
          table,
          model,
          input.scalars,
          ctx.dialect,
        );
        const parentId = parent[primaryKeyOf(model)];
        for (const [field, relation] of m2mFields) {
          const link = ctx.m2m.get(`${model.name}.${field}`);
          if (!link) continue;
          await insertM2mRows(tx, link, parentId, relation.ids);
        }
        return parent;
      });
    },

    async updateRecord(model, id, input) {
      const table = tableFor(ctx, model);
      const m2mFields = Object.entries(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return updateAndReturn(
          db,
          table,
          model,
          id,
          input.scalars,
          ctx.dialect,
        );
      }
      if (ctx.dialect === "sqlite") {
        return db.transaction((tx: any) => {
          const parent = updateAndReturnSqlite(
            tx,
            table,
            model,
            id,
            input.scalars,
          );
          const parentId = coerceId(String(id), model);
          for (const [field, relation] of m2mFields) {
            const link = ctx.m2m.get(`${model.name}.${field}`);
            if (!link) continue;
            tx.delete(link.pivot).where(eq(link.selfColumn, parentId)).run();
            insertM2mRowsSqlite(tx, link, parentId, relation.ids);
          }
          return parent;
        });
      }
      return db.transaction(async (tx: any) => {
        const parent = await updateAndReturn(
          tx,
          table,
          model,
          id,
          input.scalars,
          ctx.dialect,
        );
        const parentId = coerceId(String(id), model);
        for (const [field, relation] of m2mFields) {
          const link = ctx.m2m.get(`${model.name}.${field}`);
          if (!link) continue;
          await tx.delete(link.pivot).where(eq(link.selfColumn, parentId));
          await insertM2mRows(tx, link, parentId, relation.ids);
        }
        return parent;
      });
    },

    async deleteRecord(model, id) {
      const table = tableFor(ctx, model);
      const coercedId = coerceId(String(id), model);
      const links = [...ctx.m2m.entries()]
        .filter(([key]) => key.startsWith(`${model.name}.`))
        .map(([, link]) => link);
      if (ctx.dialect === "sqlite") {
        db.transaction((tx: any) => {
          for (const link of links) {
            tx.delete(link.pivot).where(eq(link.selfColumn, coercedId)).run();
          }
          tx.delete(table)
            .where(eq(primaryKeyColumn(table, model), coercedId))
            .run();
        });
        return;
      }
      await db.transaction(async (tx: any) => {
        for (const link of links) {
          await tx.delete(link.pivot).where(eq(link.selfColumn, coercedId));
        }
        await tx.delete(table).where(eq(primaryKeyColumn(table, model), coercedId));
      });
    },

    async getM2mSelectedIds(model, edge, _targetModel, recordId) {
      const link = ctx.m2m.get(`${model.name}.${edge.field}`);
      if (!link) return [];
      const rows = await db
        .select({ id: link.otherColumn })
        .from(link.pivot)
        .where(eq(link.selfColumn, coerceId(String(recordId), model)));
      return rows.map((row: { id: string | number }) => row.id);
    },
  };
}
