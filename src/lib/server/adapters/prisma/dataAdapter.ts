import type { Model } from '../../types/schema.js';
import type { RelationEdge } from '../../introspection/relations.js';
import { toPrismaModel, primaryKeyOf, coerceId } from '../../data.js';
import { compileFilterToPrismaWhere } from './filterCompiler.js';
import type { DataAdapter, Filter, TargetGuard } from '../types.js';
import { withWriteRetry } from '../retry.js';

/**
 * Revalidation des cibles de relation à l'intérieur de la transaction d'écriture.
 *
 * Fenêtre résiduelle, assumée : cette lecture ne pose aucun verrou de ligne.
 * Sur PostgreSQL, `Serializable` ne l'empêche PAS — mesuré sur PG 16 : SSI ne
 * voit aucun cycle de dépendances dans « lire le guard -> un tiers sort la
 * cible du scope -> écrire », donc les deux transactions committent. L'adapter
 * Drizzle ferme cette fenêtre avec un `FOR SHARE` ; Prisma n'expose aucune API
 * de verrou, et l'émettre demanderait du `$queryRaw` par dialecte, donc les
 * noms physiques de tables et colonnes (les `@@map`/`@map` ne sont pas parsés)
 * et un second compilateur de filtres à garder en phase avec
 * `compileFilterToPrismaWhere` — exactement le duplicata divergent que ce
 * codebase a déjà payé une fois.
 *
 * L'exposition reste bornée : `mutations.ts` a déjà revalidé chaque FK et m2m
 * par un `findFirst` scopé avant d'appeler l'adapter, et gagner cette course
 * ne produit qu'une référence orpheline inter-tenant — aucune lecture des
 * données de l'autre tenant, le scoping des dropdowns et la « chip » anti-oracle
 * tenant par ailleurs. C'est un défaut d'intégrité, pas une divulgation.
 */
async function validateTargetGuards(tx: any, guards: TargetGuard[], compile: (filter?: Filter) => any) {
  for (const guard of guards) {
    const key = toPrismaModel(guard.targetModel.name);
    const pk = primaryKeyOf(guard.targetModel);
    const where = guard.filter
      ? { [pk]: guard.targetPk, AND: [compile(guard.filter)] }
      : { [pk]: guard.targetPk };
    if (!(await tx[key].findFirst({ where }))) {
      throw new Error('relation target is outside the authorization scope');
    }
  }
}

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
      const guards = input.targetGuards ?? [];
      if (m2mFields.length === 0 && guards.length === 0) {
        return prisma[key].create({ data: input.scalars });
      }
      return withWriteRetry(() =>
        prisma.$transaction(async (tx: any) => {
          await validateTargetGuards(tx, guards, compileHere);
          const data: Record<string, unknown> = { ...input.scalars };
          for (const field of m2mFields) {
            const { targetPkField, ids } = input.m2m![field];
            data[field] = { connect: ids.map((id) => ({ [targetPkField]: id })) };
          }
          return tx[key].create({ data });
        }, { isolationLevel: "Serializable" as any })
      );
    },

    async updateRecord(model: Model, id, input, authorizationFilter?: Filter) {
      const key = toPrismaModel(model.name);
      const primaryKey = primaryKeyOf(model);
      const where = authorizationFilter
        ? { [primaryKey]: coerceId(String(id), model), AND: [compileHere(authorizationFilter)] }
        : { [primaryKey]: coerceId(String(id), model) };
      const m2mFields = Object.keys(input.m2m ?? {});
      const guards = input.targetGuards ?? [];
      if (m2mFields.length === 0 && guards.length === 0) {
        return prisma[key].update({ where, data: input.scalars });
      }
      return withWriteRetry(() =>
        prisma.$transaction(async (tx: any) => {
          await validateTargetGuards(tx, guards, compileHere);
          const data: Record<string, unknown> = { ...input.scalars };
          for (const field of m2mFields) {
            const { targetPkField, ids } = input.m2m![field];
            data[field] = { set: ids.map((id) => ({ [targetPkField]: id })) };
          }
          return tx[key].update({ where, data });
        }, { isolationLevel: "Serializable" as any })
      );
    },

    async deleteRecord(model: Model, id, authorizationFilter?: Filter) {
      const primaryKey = primaryKeyOf(model);
      const where = authorizationFilter
        ? { [primaryKey]: coerceId(String(id), model), AND: [compileHere(authorizationFilter)] }
        : { [primaryKey]: coerceId(String(id), model) };
      await prisma[toPrismaModel(model.name)].delete({ where });
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
