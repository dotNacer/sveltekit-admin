import type { Model } from '../../types/schema.js';
import type { RelationEdge } from '../../introspection/relations.js';
import { toPrismaModel, primaryKeyOf, coerceId } from '../../data.js';
import { compileFilterToPrismaWhere } from './filterCompiler.js';
import type { DataAdapter, Filter } from '../types.js';

/**
 * Prisma implementation of `DataAdapter`. `caseInsensitiveSearch` is fixed
 * at construction time (Task 5's boot block resolves it from the schema's
 * `provider`/`config.search.mode` before building this adapter) — it's the
 * same value `buildWhere`'s caller in `handler.ts` used to pass directly to
 * `buildWhere`, just applied one layer later, at compile-to-Prisma-where
 * time instead of at Filter-construction time. It only affects `contains`
 * leaves; every other leaf/composite op ignores it.
 */
export function createPrismaDataAdapter(
  prisma: any,
  opts: { caseInsensitiveSearch?: boolean } = {}
): DataAdapter {
  const compileHere = (filter: Filter | undefined) =>
    compileFilterToPrismaWhere(filter, opts.caseInsensitiveSearch ?? false);

  return {
    async listRecords(model: Model, listOpts) {
      const key = toPrismaModel(model.name);
      const primaryKey = primaryKeyOf(model);
      const where = compileHere(listOpts.filter);
      const [rows, total] = await Promise.all([
        prisma[key].findMany({ where, skip: listOpts.skip, take: listOpts.take, orderBy: { [primaryKey]: 'desc' } }),
        prisma[key].count({ where })
      ]);
      return { rows, total };
    },

    findMany(model: Model, findOpts) {
      const key = toPrismaModel(model.name);
      const where = compileHere(findOpts.filter);
      return prisma[key].findMany({ where, orderBy: findOpts.orderBy, skip: findOpts.skip, take: findOpts.take });
    },

    getRecord(model: Model, id) {
      const primaryKey = primaryKeyOf(model);
      return prisma[toPrismaModel(model.name)].findUnique({
        where: { [primaryKey]: coerceId(String(id), model) }
      });
    },

    findFirst(model: Model, filter) {
      const key = toPrismaModel(model.name);
      return prisma[key].findFirst({ where: compileHere(filter) });
    },

    countRecords(model: Model, filter) {
      const key = toPrismaModel(model.name);
      return prisma[key].count({ where: compileHere(filter) });
    },

    async createRecord(model: Model, input) {
      const key = toPrismaModel(model.name);
      const m2mFields = Object.keys(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return prisma[key].create({ data: input.scalars });
      }
      return prisma.$transaction(async (tx: any) => {
        const data: Record<string, unknown> = { ...input.scalars };
        for (const field of m2mFields) {
          const { targetPkField, ids } = input.m2m![field];
          data[field] = { connect: ids.map((id) => ({ [targetPkField]: id })) };
        }
        return tx[key].create({ data });
      });
    },

    async updateRecord(model: Model, id, input) {
      const key = toPrismaModel(model.name);
      const primaryKey = primaryKeyOf(model);
      const where = { [primaryKey]: coerceId(String(id), model) };
      const m2mFields = Object.keys(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return prisma[key].update({ where, data: input.scalars });
      }
      return prisma.$transaction(async (tx: any) => {
        const data: Record<string, unknown> = { ...input.scalars };
        for (const field of m2mFields) {
          const { targetPkField, ids } = input.m2m![field];
          data[field] = { set: ids.map((id) => ({ [targetPkField]: id })) };
        }
        return tx[key].update({ where, data });
      });
    },

    async deleteRecord(model: Model, id) {
      const primaryKey = primaryKeyOf(model);
      await prisma[toPrismaModel(model.name)].delete({ where: { [primaryKey]: coerceId(String(id), model) } });
    },

    async getM2mSelectedIds(model: Model, edge: RelationEdge, targetModel: Model, recordId) {
      try {
        const primaryKey = primaryKeyOf(model);
        const current = await prisma[toPrismaModel(model.name)].findUnique({
          where: { [primaryKey]: coerceId(String(recordId), model) },
          include: { [edge.field]: true }
        });
        const linked: Record<string, unknown>[] = current?.[edge.field] ?? [];
        const targetPk = primaryKeyOf(targetModel);
        return linked.map((row) => row[targetPk] as string | number);
      } catch {
        return [];
      }
    }
  };
}
