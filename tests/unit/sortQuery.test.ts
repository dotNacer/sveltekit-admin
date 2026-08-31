import { describe, it, expect } from 'vitest';
import { parseSortQuery } from '../../src/lib/server/query/sortQuery.js';

/**
 * Le nom de colonne venu de l'URL ne sert JAMAIS de clé directement : il est
 * cherché dans la liste des colonnes que la vue rend, et seul un membre de
 * cette liste ressort. Même règle que les opérateurs de filtre
 * (`listQuery.ts`) : l'URL choisit dans une liste finie, elle ne décrit rien.
 */

const sortable = ['email', 'name'];
const parse = (qs: string) => parseSortQuery(new URLSearchParams(qs), sortable);

describe('parseSortQuery', () => {
  it('ne trie pas sans paramètre', () => {
    expect(parse('')).toEqual({ active: null, ignored: false });
  });

  it('traite un paramètre vide comme absent', () => {
    expect(parse('sort=')).toEqual({ active: null, ignored: false });
  });

  it('trie en ascendant par défaut', () => {
    expect(parse('sort=email')).toEqual({ active: { field: 'email', dir: 'asc' }, ignored: false });
  });

  it('accepte la direction descendante', () => {
    expect(parse('sort=email&dir=desc').active).toEqual({ field: 'email', dir: 'desc' });
  });

  it('retombe en ascendant sur une direction inconnue', () => {
    expect(parse('sort=email&dir=sideways').active).toEqual({ field: 'email', dir: 'asc' });
  });

  it('ignore une colonne absente de la liste', () => {
    expect(parse('sort=passwordHash')).toEqual({ active: null, ignored: true });
  });

  it('ignore une colonne que la vue ne rend pas, même si elle existe', () => {
    // `sortable` est exactement ce que la liste affiche : une colonne masquée
    // par `hidden` ou tronquée par le plafond n'y est pas, donc pas triable.
    expect(parse('sort=bio')).toEqual({ active: null, ignored: true });
  });
});
