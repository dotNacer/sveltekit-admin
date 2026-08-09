import { describe, it, expect } from 'vitest';
import {
  toPrismaModel, primaryKeyOf, coerceId, formDataToPrisma, paginate,
  listRecords, getRecord, createRecord, updateRecord, deleteRecord
} from '../../src/lib/server/data.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

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

describe('opérations Prisma', () => {
  const records = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, email: `u${i}@x.y` }));

  it('liste avec skip, take et tri sur la PK', async () => {
    const prisma = createPrismaMock({ user: records });
    const { items, total } = await listRecords(prisma, User, 2, 2);
    expect(items).toEqual([{ id: 3, email: 'u2@x.y' }, { id: 4, email: 'u3@x.y' }]);
    expect(total).toBe(5);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({
      where: undefined, skip: 2, take: 2, orderBy: { id: 'desc' }
    });
  });

  it('liste filtrée : le where est propagé à findMany et count', async () => {
    const prisma = createPrismaMock({ user: records });
    const { items, total } = await listRecords(prisma, User, 1, 20, { id: 3 });
    expect(items).toEqual([{ id: 3, email: 'u2@x.y' }]);
    expect(total).toBe(1);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({ where: { id: 3 } });
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: { id: 3 } });
  });

  it('récupère un enregistrement par PK coercée', async () => {
    const prisma = createPrismaMock({ user: records });
    expect(await getRecord(prisma, User, '3')).toEqual({ id: 3, email: 'u2@x.y' });
    expect(callsTo(prisma, 'user', 'findUnique')[0].args).toEqual({ where: { id: 3 } });
  });

  it('renvoie null sur un id absent', async () => {
    const prisma = createPrismaMock({ user: records });
    expect(await getRecord(prisma, User, '99')).toBeNull();
  });

  it('crée avec les données fournies', async () => {
    const prisma = createPrismaMock({ user: [] });
    await createRecord(prisma, User, { email: 'n@x.y' });
    expect(callsTo(prisma, 'user', 'create')[0].args).toEqual({ data: { email: 'n@x.y' } });
  });

  it('met à jour par PK', async () => {
    const prisma = createPrismaMock({ user: records });
    await updateRecord(prisma, User, '2', { email: 'up@x.y' });
    expect(callsTo(prisma, 'user', 'update')[0].args).toEqual({
      where: { id: 2 }, data: { email: 'up@x.y' }
    });
  });

  it('supprime par PK', async () => {
    const prisma = createPrismaMock({ user: records });
    await deleteRecord(prisma, User, '2');
    expect(callsTo(prisma, 'user', 'delete')[0].args).toEqual({ where: { id: 2 } });
  });

  it('propage l’erreur du client Prisma', async () => {
    const prisma = createPrismaMock({ user: [] }, { user: { count: () => { throw new Error('down'); } } });
    await expect(listRecords(prisma, User, 1, 20)).rejects.toThrow('down');
  });

  it('lève si le modèle est absent du client', () => {
    const prisma = createPrismaMock({});
    // `getRecord` n'est pas `async` : sur un modèle absent, `prisma[key]` vaut
    // undefined et le TypeError part de façon SYNCHRONE au moment de l'appel de
    // `getRecord`, avant qu'aucune promesse n'existe. Le brief propose
    // `await expect(() => getRecord(...)).rejects.toThrow()`, mais dans cette
    // version de Vitest (3.2.7) le getter `.rejects` invoque lui-même la
    // fonction passée de façon SYNCHRONE (`obj()`) pour en tirer une promesse,
    // avant que `.toThrow()` ne soit chaîné : le TypeError part donc pendant
    // l'évaluation de `.rejects`, non intercepté, et le test échoue. La bonne
    // assertion pour un throw synchrone est simplement `expect(fn).toThrow()`.
    expect(() => getRecord(prisma, User, '1')).toThrow();
  });
});
