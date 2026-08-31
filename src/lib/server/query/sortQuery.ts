/**
 * `?sort=<colonne>&dir=asc|desc` → ordre de tri de la vue liste.
 *
 * Même règle d'or que les filtres (`listQuery.ts`) : la chaîne venue de l'URL
 * ne devient jamais une clé de requête. Elle est cherchée dans la liste des
 * colonnes que la vue rend réellement (`resolveListColumns`), et seul un membre
 * de cette liste ressort. Une colonne masquée par `hidden`, écartée par
 * l'heuristique de nom, ou simplement tronquée par le plafond de colonnes n'y
 * est pas — donc pas triable.
 *
 * Trier ne peut ainsi ordonner que des valeurs déjà lisibles à l'écran : le tri
 * n'ouvre aucune lecture que la liste n'offrait pas.
 */

export type SortDirection = 'asc' | 'desc';

export interface ActiveSort {
  field: string;
  dir: SortDirection;
}

export interface SortState {
  /** null = ordre par défaut (clé primaire décroissante, côté adapter). */
  active: ActiveSort | null;
  /** true quand l'URL a demandé une colonne non triable — rendu comme message. */
  ignored: boolean;
}

export function parseSortQuery(params: URLSearchParams, sortable: string[]): SortState {
  const requested = params.get('sort');
  // Vide == absent : `?sort=` est un artefact d'interface (un form GET qui
  // sérialise un champ non renseigné), pas une demande à refuser bruyamment.
  if (!requested) return { active: null, ignored: false };

  if (!sortable.includes(requested)) return { active: null, ignored: true };

  // Domaine à deux valeurs : tout ce qui n'est pas `desc` est ascendant. Rien à
  // refuser ici — contrairement au champ, une direction inconnue ne désigne
  // aucune colonne et ne peut donc rien révéler.
  const dir: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return { active: { field: requested, dir }, ignored: false };
}
