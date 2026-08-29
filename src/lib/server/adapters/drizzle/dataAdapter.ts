import { and, asc, count, desc, eq, getTableColumns } from "drizzle-orm";
import type { Column, Table } from "drizzle-orm";
import { coerceId, primaryKeyOf } from "../../data.js";
import type { Model } from "../../types/schema.js";
import type { DataAdapter, Filter, TargetGuard } from "../types.js";
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

/**
 * Ordre de verrouillage déterministe. Les guards m2m sont empilés dans l'ordre
 * des ids soumis par le formulaire, donc sous contrôle du client : deux
 * requêtes concurrentes envoyant [1,2] et [2,1] verrouilleraient les mêmes
 * lignes en sens inverse et se deadlockeraient (PostgreSQL 40P01), ce qui est
 * bien plus facile à déclencher que la course qu'on cherche à empêcher.
 * Trier sur (modèle, pk) donne un ordre total stable et supprime le cycle.
 */
function orderedGuards(guards: TargetGuard[]): TargetGuard[] {
  return [...guards].sort(
    (a, b) =>
      a.targetModel.name.localeCompare(b.targetModel.name) ||
      String(a.targetPk).localeCompare(String(b.targetPk)),
  );
}

async function validateTargetGuards(ctx: DrizzleDataAdapterContext, tx: any, guards: TargetGuard[], compile: (table: Table, filter?: Filter) => any) {
  for (const guard of orderedGuards(guards)) {
    const table = tableFor(ctx, guard.targetModel);
    const where = and(eq(primaryKeyColumn(table, guard.targetModel), guard.targetPk), compile(table, guard.filter));
    const query = tx.select().from(table).where(where).limit(1);
    // Verrou partagé tenu jusqu'au commit, PostgreSQL uniquement.
    //
    // Mesuré (PG 16, les 4 combinaisons) : SERIALIZABLE seul n'annule PAS la
    // séquence « lire le guard -> un tiers sort la cible du scope -> écrire ».
    // SSI n'y voit aucun cycle de dépendances, donc cet ordre reste
    // sérialisable et les deux transactions committent. Seul le verrou de
    // ligne ferme la fenêtre. Ne pas le retirer en pensant que le niveau
    // d'isolation suffit : c'est faux, et ça a été vérifié.
    //
    // MySQL est exclu volontairement : SERIALIZABLE y transforme déjà les
    // SELECT en lectures verrouillantes (mesuré : le writer concurrent est
    // bloqué), donc le verrou n'apporterait rien — et `for share` est une
    // syntaxe 8.0+, l'émettre casserait les schémas encore en 5.7.
    const rows = await (ctx.dialect === "postgresql" ? query.for("share") : query);
    if (rows.length === 0) throw new Error("relation target is outside the authorization scope");
  }
}

function validateTargetGuardsSqlite(ctx: DrizzleDataAdapterContext, tx: any, guards: TargetGuard[], compile: (table: Table, filter?: Filter) => any) {
  // Pas de clause de verrou en SQLite (absente de sqlite-core, et inutile :
  // l'écriture concurrente échoue fermée, cf. le commentaire ci-dessus).
  for (const guard of orderedGuards(guards)) {
    const table = tableFor(ctx, guard.targetModel);
    const where = and(eq(primaryKeyColumn(table, guard.targetModel), guard.targetPk), compile(table, guard.filter));
    const row = tx.select().from(table).where(where).limit(1).get();
    if (!row) throw new Error("relation target is outside the authorization scope");
  }
}

async function selectByPrimaryKey(
  db: any,
  table: Table,
  model: Model,
  id: string | number,
  authorizationFilter?: any,
): Promise<Record<string, unknown> | null> {
  const primaryKeyWhere = eq(primaryKeyColumn(table, model), coerceId(String(id), model));
  const rows = await db
    .select()
    .from(table)
    .where(authorizationFilter ? and(primaryKeyWhere, authorizationFilter) : primaryKeyWhere)
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
  authorizationFilter?: any,
): Promise<Record<string, unknown>> {
  const coercedId = coerceId(String(id), model);
  const where = authorizationFilter
    ? and(eq(primaryKeyColumn(table, model), coercedId), authorizationFilter)
    : eq(primaryKeyColumn(table, model), coercedId);
  if (dialect === "mysql") {
    await db.update(table).set(scalars).where(where);
    const row = await selectByPrimaryKey(db, table, model, coercedId, authorizationFilter);
    if (!row) throw new Error("record is outside the authorization scope");
    return row;
  }
  const rows = await db.update(table).set(scalars).where(where).returning();
  const row = rows[0];
  if (!row) throw new Error("record is outside the authorization scope");
  return row;
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
  authorizationFilter?: any,
): Record<string, unknown> {
  const row = db
    .update(table)
    .set(scalars)
    .where(authorizationFilter ? and(eq(primaryKeyColumn(table, model), coerceId(String(id), model)), authorizationFilter) : eq(primaryKeyColumn(table, model), coerceId(String(id), model)))
    .returning()
    .get();
  if (!row) throw new Error("record is outside the authorization scope");
  return row;
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
      const guards = input.targetGuards ?? [];
      if (m2mFields.length === 0 && guards.length === 0) {
        return insertAndReturn(db, table, model, input.scalars, ctx.dialect);
      }
      if (ctx.dialect === "sqlite") {
        return db.transaction((tx: any) => {
          validateTargetGuardsSqlite(ctx, tx, guards, compileHere);
          const parent = insertAndReturnSqlite(tx, table, input.scalars);
          const parentId = parent[primaryKeyOf(model)];
          for (const [field, relation] of m2mFields) {
            const link = ctx.m2m.get(`${model.name}.${field}`);
            if (!link) continue;
            insertM2mRowsSqlite(tx, link, parentId, relation.ids);
          }
          return parent;
        }, { behavior: "immediate" });
      }
      return db.transaction(async (tx: any) => {
        await validateTargetGuards(ctx, tx, guards, compileHere);
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
      }, { isolationLevel: "serializable" });
    },

    async updateRecord(model, id, input, authorizationFilter) {
      const table = tableFor(ctx, model);
      const m2mFields = Object.entries(input.m2m ?? {});
      const guards = input.targetGuards ?? [];
      if (m2mFields.length === 0 && guards.length === 0) {
        return updateAndReturn(
          db,
          table,
          model,
          id,
          input.scalars,
          ctx.dialect,
          compileHere(table, authorizationFilter),
        );
      }
      if (ctx.dialect === "sqlite") {
        return db.transaction((tx: any) => {
          validateTargetGuardsSqlite(ctx, tx, guards, compileHere);
          const parent = updateAndReturnSqlite(
            tx,
            table,
            model,
            id,
            input.scalars,
            compileHere(table, authorizationFilter),
          );
          const parentId = coerceId(String(id), model);
          for (const [field, relation] of m2mFields) {
            const link = ctx.m2m.get(`${model.name}.${field}`);
            if (!link) continue;
            tx.delete(link.pivot).where(eq(link.selfColumn, parentId)).run();
            insertM2mRowsSqlite(tx, link, parentId, relation.ids);
          }
          return parent;
        }, { behavior: "immediate" });
      }
      return db.transaction(async (tx: any) => {
        await validateTargetGuards(ctx, tx, guards, compileHere);
        const parent = await updateAndReturn(
          tx,
          table,
          model,
          id,
          input.scalars,
          ctx.dialect,
          compileHere(table, authorizationFilter),
        );
        const parentId = coerceId(String(id), model);
        for (const [field, relation] of m2mFields) {
          const link = ctx.m2m.get(`${model.name}.${field}`);
          if (!link) continue;
          await tx.delete(link.pivot).where(eq(link.selfColumn, parentId));
          await insertM2mRows(tx, link, parentId, relation.ids);
        }
        return parent;
      }, { isolationLevel: "serializable" });
    },

    async deleteRecord(model, id, authorizationFilter) {
      const table = tableFor(ctx, model);
      const coercedId = coerceId(String(id), model);
      const links = [...ctx.m2m.entries()]
        .filter(([key]) => key.startsWith(`${model.name}.`))
        .map(([, link]) => link);
      const parentWhere = and(eq(primaryKeyColumn(table, model), coercedId), compileHere(table, authorizationFilter));
      if (links.length === 0) {
        if (ctx.dialect === "sqlite") {
          const result = db.delete(table).where(parentWhere).run();
          if (result.changes !== 1) throw new Error("record is outside the authorization scope");
        } else {
          const result = await db.delete(table).where(parentWhere);
          if (Number(result?.affectedRows ?? 0) !== 1) throw new Error("record is outside the authorization scope");
        }
        return;
      }
      // Les pivots partent avant le parent, l'ordre qu'imposent les FK. Le DELETE
      // scopé du parent sert lui-même de garde : zéro ligne touchée => throw =>
      // rollback des pivots. Pas de SELECT de vérification préalable, donc aucune
      // fenêtre TOCTOU entre la lecture du scope et la suppression, et aucune
      // branche défensive inatteignable.
      if (ctx.dialect === "sqlite") {
        db.transaction((tx: any) => {
          for (const link of links) tx.delete(link.pivot).where(eq(link.selfColumn, coercedId)).run();
          const result = tx.delete(table).where(parentWhere).run();
          if (result.changes !== 1) throw new Error("record is outside the authorization scope");
        }, { behavior: "immediate" });
        return;
      }
      await db.transaction(async (tx: any) => {
        for (const link of links) await tx.delete(link.pivot).where(eq(link.selfColumn, coercedId));
        if (ctx.dialect === "postgresql") {
          const deleted = await tx.delete(table).where(parentWhere).returning({ id: primaryKeyColumn(table, model) });
          if (deleted.length !== 1) throw new Error("record is outside the authorization scope");
        } else {
          const result = await tx.delete(table).where(parentWhere);
          if (Number(result?.affectedRows ?? 0) !== 1) throw new Error("record is outside the authorization scope");
        }
      }, { isolationLevel: "serializable" });
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
