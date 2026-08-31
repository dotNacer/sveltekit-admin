/**
 * Taille de page : celle configurée, et celles qu'un `?perPage=` a le droit de
 * demander.
 *
 * Le point qui compte : la valeur venue de l'URL n'est jamais utilisée telle
 * quelle. Elle doit appartenir à la liste proposée, sinon `?perPage=100000`
 * devient un `take` non borné — un déni de service à un paramètre près, et sur
 * une table volumineuse une requête qui tient la connexion. C'est la même règle
 * d'or que les opérateurs de filtre et les colonnes de tri : l'URL choisit dans
 * une liste finie, elle ne décrit rien.
 */

/**
 * Tailles sélectionnables : les options configurées, plus la taille par défaut
 * (sinon elle serait active sans figurer dans le sélecteur), triées et
 * dédoublonnées. Une liste d'options vide désactive entièrement le mécanisme —
 * pas de sélecteur, et `?perPage=` sans effet.
 */
export function resolvePageSizes(perPage: number, options: number[]): number[] {
  if (options.length === 0) return [];
  return [...new Set([...options, perPage])].sort((a, b) => a - b);
}

export function parsePageSize(
  params: URLSearchParams,
  fallback: number,
  selectable: number[]
): number {
  const requested = Number(params.get('perPage'));
  return selectable.includes(requested) ? requested : fallback;
}
