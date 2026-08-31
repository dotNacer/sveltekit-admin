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

/**
 * Convertit un FormData en payload Prisma, en ignorant les champs auto-gérés.
 *
 * Renvoie aussi la liste des champs dont la valeur soumise ne se convertit pas
 * vers le type de la colonne : un JSON illisible, un nombre qui n'en est pas
 * un. Leur clé est laissée HORS du payload, et c'est `mutations.ts` — le seul
 * producteur de refus côté bibliothèque, cf. `errors.ts` — qui décide quoi en
 * faire. Cette fonction ne lève pas : elle convertit et rapporte.
 *
 * Ces valeurs étaient auparavant écrites en `null` sans un mot. Sur une colonne
 * nullable, la saisie et la valeur déjà stockée disparaissaient ensemble
 * derrière un `303` d'apparence réussie ; sur une colonne obligatoire, le
 * pilote répondait par un message générique ne nommant aucun champ.
 */
export function formDataToPrisma(
  formData: FormData,
  model: PrismaModel
): { data: Record<string, unknown>; invalid: string[] } {
  const data: Record<string, unknown> = {};
  const invalid: string[] = [];

  for (const field of model.fields) {
    if (field.isId || field.isUpdatedAt || field.isCreatedAt || field.relation) continue;

    const value = formData.get(field.name);
    if (value === null) {
      if (field.type === 'Boolean') data[field.name] = false;
      continue;
    }

    switch (field.type) {
      case 'Int':
      case 'BigInt': {
        const parsed = value ? parseInt(value.toString()) : null;
        if (Number.isNaN(parsed)) invalid.push(field.name);
        else data[field.name] = parsed;
        break;
      }
      case 'Float':
      case 'Decimal': {
        const parsed = value ? parseFloat(value.toString()) : null;
        if (Number.isNaN(parsed)) invalid.push(field.name);
        else data[field.name] = parsed;
        break;
      }
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
          invalid.push(field.name);
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

  return { data, invalid };
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
