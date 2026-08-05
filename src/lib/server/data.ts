/**
 * Data access layer - derives Prisma model keys, coerces ids and form payloads,
 * and wraps the CRUD calls the handler orchestrates.
 */

import type { PrismaModel } from './introspection/parser.js';

export function toPrismaModel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function primaryKeyOf(model: PrismaModel): string {
  return model.fields.find((f) => f.isId)?.name || 'id';
}

/**
 * Comportement conservé à l'identique de l'ancien handler : la coercion ne
 * consulte pas le type de la clé primaire, d'où le paramètre `_model` inutilisé.
 * Corrigé en Task 15 (défaut n° 4).
 */
export function coerceId(id: string, _model: PrismaModel): string | number {
  return /^\d+$/.test(id) ? parseInt(id) : id;
}

/** Convertit un FormData en payload Prisma, en ignorant les champs auto-gérés. */
export function formDataToPrisma(formData: FormData, model: PrismaModel): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of model.fields) {
    if (field.isId || field.isUpdatedAt || field.isCreatedAt || field.relation) continue;

    const value = formData.get(field.name);
    if (value === null) {
      if (field.type === 'Boolean') data[field.name] = false;
      continue;
    }

    switch (field.type) {
      case 'Int':
      case 'BigInt':
        data[field.name] = value ? parseInt(value.toString()) : null;
        break;
      case 'Float':
      case 'Decimal':
        data[field.name] = value ? parseFloat(value.toString()) : null;
        break;
      case 'Boolean':
        data[field.name] = value === 'on' || value === 'true' || value === '1';
        break;
      case 'DateTime':
        data[field.name] = value ? new Date(value.toString()) : null;
        break;
      case 'Json':
        try {
          data[field.name] = value ? JSON.parse(value.toString()) : null;
        } catch {
          data[field.name] = null;
        }
        break;
      default:
        data[field.name] = value.toString();
    }
  }

  return data;
}

/**
 * Comportement conservé à l'identique de l'ancien handler : aucune validation.
 * `parseInt('abc')` donne `NaN` et la page `0` un `skip` négatif ; les deux
 * atteignent Prisma. Corrigé plus tard.
 */
export function paginate(
  pageParam: string | null,
  perPage: number
): { page: number; skip: number; take: number } {
  const page = parseInt(pageParam || '1');
  return { page, skip: (page - 1) * perPage, take: perPage };
}

export async function listRecords(
  prisma: any,
  model: PrismaModel,
  page: number,
  perPage: number
): Promise<{ items: any[]; total: number }> {
  const key = toPrismaModel(model.name);
  const primaryKey = primaryKeyOf(model);

  const [items, total] = await Promise.all([
    prisma[key].findMany({
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { [primaryKey]: 'desc' }
    }),
    prisma[key].count()
  ]);

  return { items, total };
}

export function getRecord(prisma: any, model: PrismaModel, id: string): Promise<any | null> {
  const primaryKey = primaryKeyOf(model);
  return prisma[toPrismaModel(model.name)].findUnique({
    where: { [primaryKey]: coerceId(id, model) }
  });
}

export async function createRecord(
  prisma: any,
  model: PrismaModel,
  data: Record<string, unknown>
): Promise<void> {
  await prisma[toPrismaModel(model.name)].create({ data });
}

export async function updateRecord(
  prisma: any,
  model: PrismaModel,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const primaryKey = primaryKeyOf(model);
  await prisma[toPrismaModel(model.name)].update({
    where: { [primaryKey]: coerceId(id, model) },
    data
  });
}

export async function deleteRecord(prisma: any, model: PrismaModel, id: string): Promise<void> {
  const primaryKey = primaryKeyOf(model);
  await prisma[toPrismaModel(model.name)].delete({
    where: { [primaryKey]: coerceId(id, model) }
  });
}
