/**
 * Fenêtre de numéros de page : « 1 … 8 9 [10] 11 12 … 20 ».
 *
 * Pure, et volontairement hors du composant : les cas limites (premiers et
 * derniers écrans, trous d'une seule page) se testent sur des nombres plutôt
 * qu'en fouillant du HTML.
 */

/** Nombre de pages affichées de part et d'autre de la page courante. */
const SPAN = 2;

export type PageEntry = number | 'gap';

export function paginationWindow(page: number, totalPages: number): PageEntry[] {
  if (totalPages <= 1) return [];

  const first = 1;
  const last = totalPages;
  const from = Math.max(first, page - SPAN);
  const to = Math.min(last, page + SPAN);

  const entries: PageEntry[] = [];
  for (let n = from; n <= to; n++) entries.push(n);

  // Un trou qui ne cacherait qu'une seule page ne gagne aucune place et coûte
  // un clic : on montre la page à la place. D'où la comparaison à 1 et non 0.
  if (from - first > 1) entries.unshift(first, 'gap');
  else if (from > first) entries.unshift(first);

  if (last - to > 1) entries.push('gap', last);
  else if (to < last) entries.push(last);

  return entries;
}
