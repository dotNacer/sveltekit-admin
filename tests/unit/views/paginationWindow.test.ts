import { describe, it, expect } from 'vitest';
import { paginationWindow } from '../../../src/lib/server/views/pagination.js';

/**
 * Fonction pure : la vue ne fait que rendre ce qu'elle renvoie. Les cas
 * limites (bords, trous d'une seule page) se testent donc ici plutôt qu'à
 * travers du HTML.
 */

describe('paginationWindow', () => {
  it('ne rend rien sur une seule page', () => {
    expect(paginationWindow(1, 1)).toEqual([]);
  });

  it('rend toutes les pages quand elles tiennent', () => {
    expect(paginationWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('coupe la fin depuis le début', () => {
    expect(paginationWindow(1, 20)).toEqual([1, 2, 3, 'gap', 20]);
  });

  it('coupe le début depuis la fin', () => {
    expect(paginationWindow(20, 20)).toEqual([1, 'gap', 18, 19, 20]);
  });

  it('coupe des deux côtés au milieu', () => {
    expect(paginationWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
  });

  it('affiche la page plutôt qu’un trou d’une seule page', () => {
    // « 1 … 3 » cache exactement la page 2 : autant la montrer, le trou ne
    // gagne aucune place et coûte un clic.
    expect(paginationWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 20]);
  });

  it('applique la même règle du côté droit', () => {
    expect(paginationWindow(17, 20)).toEqual([1, 'gap', 15, 16, 17, 18, 19, 20]);
  });

  it('garde la page courante centrée', () => {
    const window = paginationWindow(50, 100);
    expect(window).toContain(50);
    expect(window.filter((entry) => entry === 'gap')).toHaveLength(2);
  });
});
