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
 * Coerce l'id issu de l'URL vers le type de la clé primaire du modèle.
 *
 * L'ancienne implémentation appliquait `/^\d+$/.test(id) ? parseInt(id) : id`
 * sans consulter le schéma : une PK String dont la valeur est entièrement
 * numérique partait donc en nombre, et le vrai client Prisma rejetait la requête
 * (`Argument \`id\`: Invalid value provided. Expected String, provided Int.`).
 * Le mock, lui, acceptait n'importe quel type — d'où le test de régression
 * côté intégration.
 */
export function coerceId(id: string, model: PrismaModel): string | number {
  const pkField = model.fields.find((f) => f.name === primaryKeyOf(model));
  return pkField?.type === 'Int' ? parseInt(id) : id;
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
 * Traduit le paramètre `?page=` en fenêtre Prisma. Toute entrée qui n'est pas un
 * entier sûr >= 1 retombe sur la première page : sans ce garde-fou, `?page=abc`
 * envoyait `skip: NaN` et `?page=0` un `skip` négatif directement au client.
 */
export function paginate(
  pageParam: string | null,
  perPage: number
): { page: number; skip: number; take: number } {
  const parsed = parseInt(pageParam || '1');
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
  return { page, skip: (page - 1) * perPage, take: perPage };
}

export async function listRecords(
  prisma: any,
  model: PrismaModel,
  page: number,
  perPage: number,
  where?: Record<string, unknown>
): Promise<{ items: any[]; total: number }> {
  const key = toPrismaModel(model.name);
  const primaryKey = primaryKeyOf(model);

  // Le calcul `(page - 1) * perPage` est dupliqué avec `paginate` DÉLIBÉRÉMENT.
  // Router `listRecords` vers `paginate(String(page), perPage)` serait lossy : la
  // conversion aller-retour passe par `parseInt`, et `String(1e24)` donne
  // `'1e+24'`, que `parseInt` ramène à `1`. `listRecords` reçoit un `number` déjà
  // validé par l'appelant ; ne pas « simplifier » en réintroduisant un parse.
  const [items, total] = await Promise.all([
    prisma[key].findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { [primaryKey]: 'desc' }
    }),
    prisma[key].count({ where })
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
