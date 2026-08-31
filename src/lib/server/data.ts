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
        // Le vide vaut `null`, comme pour les types au-dessus. Écrire `''`
        // rendait une chaîne vide indistinguable d'une valeur voulue, violait
        // une colonne `String? @unique` dès la deuxième ligne vidée, et
        // n'était de toute façon pas une valeur qu'un type enum déclare.
        // Un champ ABSENT du formulaire ne passe pas par ici (`continue`
        // au-dessus) : c'est cette distinction que `mutations.ts` exploite
        // pour séparer « non soumis » de « vidé ».
        data[field.name] = value.toString() || null;
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
