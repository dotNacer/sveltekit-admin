import { describe, it, expect } from 'vitest';
import {
  toPrismaModel, primaryKeyOf, coerceId, formDataToPrisma, paginate
} from '../../src/lib/server/data.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const Post = schema.models.find((m) => m.name === 'Post')!;
const Category = schema.models.find((m) => m.name === 'Category')!;

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('toPrismaModel', () => {
  it.each([['User', 'user'], ['Post', 'post'], ['APIKey', 'aPIKey'], ['a', 'a']])(
    '%s → %s', (input, expected) => expect(toPrismaModel(input)).toBe(expected)
  );
});

describe('primaryKeyOf', () => {
  it('renvoie le champ @id', () => expect(primaryKeyOf(User)).toBe('id'));
  it('retombe sur "id" sans @id', () => expect(primaryKeyOf(Category)).toBe('id'));
});

describe('coerceId', () => {
  // User a une PK Int : tout passe par parseInt, y compris les entrées que
  // l'ancienne heuristique /^\d+$/ laissait en chaîne.
  it.each<[string, string | number]>([
    ['1', 1], ['42', 42], ['007', 7], ['-1', -1]
  ])('%s → %s', (input, expected) => {
    expect(coerceId(input, User)).toBe(expected);
  });

  it('tronque au préfixe numérique, comme parseInt', () => {
    expect(coerceId('1a', User)).toBe(1);
  });

  it.each(['ckabc123', ''])(
    'donne NaN pour %s sur une PK Int, comme parseInt', (input) => {
      expect(coerceId(input, User)).toBeNaN();
    }
  );
});

describe('coerceId — type de la clé primaire', () => {
  it('convertit en nombre pour une PK Int', () => {
    expect(coerceId('12345', User)).toBe(12345);
  });

  it('laisse une chaîne pour une PK String, même toute numérique', () => {
    expect(coerceId('12345', Post)).toBe('12345');
  });

  it('laisse une chaîne pour un modèle sans @id', () => {
    expect(coerceId('7', Category)).toBe('7');
  });
});

describe('formDataToPrisma', () => {
  it('convertit les entiers', () => {
    expect(formDataToPrisma(form({ authorId: '7' }), Post).authorId).toBe(7);
  });

  it('met un entier vide à null', () => {
    expect(formDataToPrisma(form({ authorId: '' }), Post).authorId).toBeNull();
  });

  it('convertit un BigInt', () => {
    expect(formDataToPrisma(form({ visits: '5' }), User).visits).toBe(5);
  });

  it('convertit les flottants et décimaux', () => {
    const data = formDataToPrisma(form({ rating: '4.5', balance: '10.25' }), User);
    expect(data.rating).toBe(4.5);
    expect(data.balance).toBe(10.25);
  });

  it('met un flottant vide à null', () => {
    expect(formDataToPrisma(form({ rating: '' }), User).rating).toBeNull();
  });

  it.each(['on', 'true', '1'])('lit le booléen coché "%s"', (value) => {
    expect(formDataToPrisma(form({ isActive: value }), User).isActive).toBe(true);
  });

  it('lit une autre valeur comme faux', () => {
    expect(formDataToPrisma(form({ isActive: 'off' }), User).isActive).toBe(false);
  });

  it('met un booléen absent à faux', () => {
    expect(formDataToPrisma(form({}), User).isActive).toBe(false);
  });

  it('convertit les dates', () => {
    const data = formDataToPrisma(form({ publishedAt: '2026-03-01T12:00' }), Post);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('met une date vide à null', () => {
    expect(formDataToPrisma(form({ publishedAt: '' }), Post).publishedAt).toBeNull();
  });

  it('parse le Json valide', () => {
    expect(formDataToPrisma(form({ metadata: '{"a":1}' }), User).metadata).toEqual({ a: 1 });
  });

  it('met le Json invalide à null', () => {
    expect(formDataToPrisma(form({ metadata: '{oops' }), User).metadata).toBeNull();
  });

  it('met le Json vide à null', () => {
    expect(formDataToPrisma(form({ metadata: '' }), User).metadata).toBeNull();
  });

  it('passe les chaînes telles quelles', () => {
    expect(formDataToPrisma(form({ email: 'a@b.c' }), User).email).toBe('a@b.c');
  });

  it.each(['id', 'createdAt', 'updatedAt'])('ignore le champ auto-géré %s', (name) => {
    expect(formDataToPrisma(form({ [name]: 'x' }), User)).not.toHaveProperty(name);
  });

  it('ignore les relations', () => {
    const data = formDataToPrisma(form({ author: '1', authorId: '1' }), Post);
    expect(data).not.toHaveProperty('author');
    expect(data.authorId).toBe(1);
  });

  it('ignore les champs liste', () => {
    expect(formDataToPrisma(form({ posts: 'x' }), User)).not.toHaveProperty('posts');
  });

  it('ignore un champ absent du schéma', () => {
    expect(formDataToPrisma(form({ notAField: 'x' }), User)).not.toHaveProperty('notAField');
  });
});

describe('paginate', () => {
  it.each([
    [null, { page: 1, skip: 0, take: 20 }],
    ['', { page: 1, skip: 0, take: 20 }],
    ['1', { page: 1, skip: 0, take: 20 }],
    ['3', { page: 3, skip: 40, take: 20 }],
    ['10', { page: 10, skip: 180, take: 20 }]
  ])('%s', (param, expected) => {
    expect(paginate(param, 20)).toEqual(expected);
  });

  it('respecte un perPage différent', () => {
    expect(paginate('2', 5)).toEqual({ page: 2, skip: 5, take: 5 });
  });
});

describe('paginate — entrées invalides', () => {
  it.each(['abc', '0', '-5', '99999999999999999999'])(
    'retombe sur la première page pour %s', (param) => {
      expect(paginate(param, 20)).toEqual({ page: 1, skip: 0, take: 20 });
    }
  );
});


describe('formDataToPrisma — vide explicite', () => {
  it('écrit null pour un String présent mais vide', () => {
    // Écrivait `''`, indistinguable d'une chaîne vide voulue, et fatal sur une
    // colonne `String? @unique` dès la deuxième ligne vide.
    expect(formDataToPrisma(form({ name: '' }), User).name).toBeNull();
  });

  it('écrit null pour un enum présent mais vide', () => {
    expect(formDataToPrisma(form({ role: '' }), User).role).toBeNull();
  });

  it("n'écrit rien pour un champ absent du formulaire", () => {
    // C'est la distinction qui porte tout le comportement : absent veut dire
    // « non soumis » (readonly, masqué, colonne à défaut), pas « vidé ».
    expect('name' in formDataToPrisma(form({ email: 'a@b.c' }), User)).toBe(false);
  });

  it('laisse intacte une valeur non vide', () => {
    expect(formDataToPrisma(form({ name: 'N' }), User).name).toBe('N');
  });
});
