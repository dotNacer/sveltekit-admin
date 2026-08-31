/**
 * Extraction des valeurs réellement soumises par un POST de formulaire admin,
 * pour les re-rendre après un échec de mutation.
 *
 * Ce module ne rend rien : il traduit un `FormData` en la forme minimale dont
 * les vues ont besoin. Il porte en revanche la décision de sécurité de ce
 * chemin — ce qui NE doit pas repartir dans le HTML.
 */

import { isSensitiveFieldName } from './introspection/parser.js';

/** Clé de dispatch de `handleMutation`, jamais un champ du modèle. */
const ACTION_KEY = '_action';
/** Préfixes posés par `RelationCheckboxes.svelte`, cf. `mutations.ts`. */
const M2M_VALUE_PREFIX = '__rel__';
const M2M_SENTINEL_PREFIX = '__rel_present__';

export interface SubmittedForm {
  /** Scalaires et scalaires de relation, par nom de champ. */
  values: Record<string, string>;
  /**
   * IDs cochés par arête m2m. Une entrée présente avec un tableau vide dit
   * « l'utilisateur a tout décoché » ; une arête absente dit « le widget
   * n'était pas dans le formulaire ». Même distinction, et même raison, que
   * le sentinelle côté écriture.
   */
  m2m: Record<string, string[]>;
}

/**
 * Un champ jamais rendu par le formulaire (`hidden`) ne doit pas non plus
 * reparaître par ce chemin, et une valeur sensible ne repart pas du tout :
 * `isSensitiveFieldName` est le prédicat partagé du dépôt (affichage en liste,
 * whitelist de recherche/filtres, rédaction d'audit), et un second heuristique
 * local finirait par diverger du premier. Conséquence assumée, celle de Django
 * (`PasswordInput(render_value=False)`) : un mot de passe est à retaper après
 * une erreur.
 */
function isEchoable(name: string, hidden: ReadonlySet<string>): boolean {
  return !hidden.has(name) && !isSensitiveFieldName(name);
}

export function readSubmittedForm(formData: FormData, hidden: ReadonlySet<string>): SubmittedForm {
  const values: Record<string, string> = {};
  const m2m: Record<string, string[]> = {};

  // Deux passes : les valeurs `__rel__` peuvent précéder leur sentinelle dans
  // le corps (l'ordre est celui du DOM, pas un contrat), donc on ne peut pas
  // décider de les garder au fil de la première itération.
  for (const key of formData.keys()) {
    if (!key.startsWith(M2M_SENTINEL_PREFIX)) continue;
    const field = key.slice(M2M_SENTINEL_PREFIX.length);
    if (!isEchoable(field, hidden)) continue;
    m2m[field] = formData.getAll(`${M2M_VALUE_PREFIX}${field}`).map(String);
  }

  for (const [key, raw] of formData.entries()) {
    if (key === ACTION_KEY) continue;
    // Les deux préfixes, testés séparément : `__rel_present__` ne commence pas
    // par `__rel__` (5e caractère `p` contre `_`), donc un seul test laisserait
    // le sentinelle passer pour un scalaire.
    if (key.startsWith(M2M_VALUE_PREFIX) || key.startsWith(M2M_SENTINEL_PREFIX)) continue;
    if (!isEchoable(key, hidden)) continue;
    values[key] = String(raw);
  }

  return { values, m2m };
}
