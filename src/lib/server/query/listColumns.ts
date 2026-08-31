/**
 * Colonnes réellement rendues par la vue liste.
 *
 * Extrait de `List.svelte`, où cette composition vivait dans un `$derived` de
 * composant : le handler en a besoin CÔTÉ SERVEUR pour décider quels champs un
 * `?sort=` a le droit de désigner. Deux implémentations de « ce que la liste
 * affiche » finiraient par diverger, et un tri autorisé sur une colonne que la
 * liste n'affiche pas est un oracle — `?sort=passwordHash` plus la pagination
 * suffit à ordonner des secrets par dichotomie. Même raison que le prédicat de
 * sensibilité partagé (`parser.ts`) : une seule source, jamais deux.
 *
 * `getDisplayFields` reste la première passe (relations, listes, noms
 * sensibles) ; cette fonction y ajoute ce que seule la config connaît.
 */

import { getDisplayFields, type PrismaField } from '../introspection/parser.js';

/** Types qu'aucune cellule ne sait rendre lisiblement. */
const UNRENDERABLE_TYPES = ['Json', 'Bytes'];

/** Au-delà, la table déborde horizontalement sur un écran ordinaire. */
const MAX_COLUMNS = 6;

export function resolveListColumns(
  fields: PrismaField[],
  opts: { hidden?: string[]; listFields?: string[] }
): PrismaField[] {
  const hidden = opts.hidden ?? [];
  const listFields = opts.listFields;
  const explicit = new Set(listFields ?? []);
  const safeNames = new Set(getDisplayFields({ fields }).map((f) => f.name));

  let columns = fields.filter(
    (f) =>
      // `listFields` explicite l'emporte sur l'heuristique de nom sensible —
      // échappatoire documentée pour ses faux positifs (`tokenCount`,
      // `hashtagCount`), et couverte par les tests de `List.svelte`. Elle ne
      // l'emporte jamais sur `hidden`, qui est un refus explicite.
      //
      // C'est aussi ce qui rend la whitelist de tri sûre sans règle en plus :
      // trier ne porte que sur des colonnes DÉJÀ rendues, donc sur des valeurs
      // que le lecteur peut lire de toute façon. Le tri n'ouvre aucun oracle
      // qui ne soit pas déjà une lecture directe.
      (explicit.has(f.name) || safeNames.has(f.name)) &&
      !hidden.includes(f.name) &&
      !f.relation &&
      !UNRENDERABLE_TYPES.includes(f.type)
  );

  if (listFields?.length) {
    columns = columns.filter((f) => listFields.includes(f.name));
  }

  return columns.slice(0, MAX_COLUMNS);
}
