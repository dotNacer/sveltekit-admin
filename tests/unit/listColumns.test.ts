import { describe, it, expect } from 'vitest';
import { resolveListColumns } from '../../src/lib/server/query/listColumns.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

/**
 * Une seule source pour « quelles colonnes la liste affiche » : les `<th>`
 * rendus et la whitelist qui autorise un `?sort=` doivent désigner exactement
 * le même ensemble. Deux heuristiques séparées finiraient par diverger, et un
 * tri sur une colonne sensible est un oracle par dichotomie.
 */

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const names = (opts: Parameters<typeof resolveListColumns>[1] = {}) =>
  resolveListColumns(User.fields, opts).map((f) => f.name);

describe('resolveListColumns', () => {
  it('écarte une colonne sensible', () => {
    expect(names()).not.toContain('password');
  });

  it('écarte une colonne masquée par la configuration', () => {
    expect(names({ hidden: ['email'] })).not.toContain('email');
  });

  it('écarte les types sans rendu en cellule', () => {
    expect(names()).not.toContain('metadata');
    expect(names()).not.toContain('avatar');
  });

  it('garde le scalaire de clé étrangère, écarte le champ de relation', () => {
    // Comportement existant, conservé tel quel : la liste montre `authorId`
    // (une colonne comme une autre) et pas `author` (rendu par le graphe de
    // relations, pas par son type). Le tri suit donc la même frontière.
    const Post = schema.models.find((m) => m.name === 'Post')!;
    const columns = resolveListColumns(Post.fields, {}).map((f) => f.name);
    expect(columns).toContain('authorId');
    expect(columns).not.toContain('author');
  });

  it('respecte listFields quand il est fourni', () => {
    expect(names({ listFields: ['email', 'name'] })).toEqual(['email', 'name']);
  });

  it('laisse listFields rouvrir une colonne que l’heuristique écarterait', () => {
    // `balance` n'est pas dans les champs « sûrs » par défaut mais reste une
    // colonne légitime : la config explicite gagne.
    expect(names({ listFields: ['balance'] })).toEqual(['balance']);
  });

  it('laisse listFields rouvrir une colonne écartée par le nom', () => {
    // Échappatoire documentée pour les faux positifs de la correspondance en
    // sous-chaîne (`tokenCount`, `hashtagCount`). Ce que la liste montre est
    // exactement ce que le tri pourra ordonner — pas de règle en plus.
    expect(names({ listFields: ['email', 'password'] })).toEqual(['email', 'password']);
  });

  it('ne rouvre jamais une colonne masquée, même listée explicitement', () => {
    expect(names({ hidden: ['email'], listFields: ['email'] })).not.toContain('email');
  });

  it('plafonne à six colonnes', () => {
    expect(names().length).toBeLessThanOrEqual(6);
  });
});
