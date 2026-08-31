import { describe, it, expect } from 'vitest';
import { resolvePageSizes, parsePageSize } from '../../src/lib/server/query/pageSize.js';

/**
 * Le « safe » de « safe configurable page size » tient à un point : la valeur
 * venue de l'URL n'est jamais utilisée telle quelle. Elle doit appartenir à la
 * liste proposée, sinon `?perPage=100000` devient un `take` non borné, donc un
 * déni de service à un paramètre près.
 */

describe('resolvePageSizes', () => {
  it('ordonne et dédoublonne les options avec la taille par défaut', () => {
    expect(resolvePageSizes(20, [50, 10, 20])).toEqual([10, 20, 50]);
  });

  it('ajoute la taille par défaut si elle manque aux options', () => {
    expect(resolvePageSizes(25, [10, 50])).toEqual([10, 25, 50]);
  });

  it('rend la liste vide quand les options le sont — sélecteur désactivé', () => {
    expect(resolvePageSizes(20, [])).toEqual([]);
  });
});

describe('parsePageSize', () => {
  const selectable = [10, 20, 50];

  it('retombe sur la valeur par défaut sans paramètre', () => {
    expect(parsePageSize(new URLSearchParams(''), 20, selectable)).toBe(20);
  });

  it('accepte une taille proposée', () => {
    expect(parsePageSize(new URLSearchParams('perPage=50'), 20, selectable)).toBe(50);
  });

  it('refuse une taille non proposée', () => {
    expect(parsePageSize(new URLSearchParams('perPage=100000'), 20, selectable)).toBe(20);
  });

  it('refuse une valeur non numérique', () => {
    expect(parsePageSize(new URLSearchParams('perPage=beaucoup'), 20, selectable)).toBe(20);
  });

  it('refuse tout quand aucune taille n’est proposée', () => {
    expect(parsePageSize(new URLSearchParams('perPage=10'), 20, [])).toBe(20);
  });
});
