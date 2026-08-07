import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSchemaContent, parsePrismaSchema, getDisplayFields
} from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH, MALFORMED_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parseSchemaContent(readFileSync(FULL_SCHEMA_PATH, 'utf-8'));
const model = (name: string) => schema.models.find((m) => m.name === name)!;
const field = (m: string, f: string) => model(m).fields.find((x) => x.name === f)!;

describe('parseSchemaContent — modèles', () => {
  it('extrait les trois modèles', () => {
    expect(schema.models.map((m) => m.name)).toEqual(['User', 'Post', 'Category']);
  });

  it('capture la doc /// du modèle', () => {
    expect(model('User').documentation).toBe('Application user');
  });

  it('laisse la doc à undefined sans commentaire ///', () => {
    expect(model('Post').documentation).toBeUndefined();
  });

  it('détecte la clé primaire déclarée', () => {
    expect(model('User').primaryKey).toBe('id');
    expect(model('Post').primaryKey).toBe('id');
  });

  it('retombe sur "id" quand aucun champ ne porte @id', () => {
    expect(model('Category').primaryKey).toBe('id');
    expect(model('Category').fields.some((f) => f.isId)).toBe(false);
  });

  it('ignore les attributs de bloc @@', () => {
    expect(model('User').fields.map((f) => f.name)).not.toContain('@@index');
  });

  it('ignore les commentaires //', () => {
    expect(model('User').fields.some((f) => f.name.startsWith('//'))).toBe(false);
  });

  it('renvoie une liste vide sur un contenu sans modèle', () => {
    expect(parseSchemaContent('// nothing here').models).toEqual([]);
  });

  it('produit un modèle sans champ pour un corps vide', () => {
    const parsed = parseSchemaContent(readFileSync(MALFORMED_SCHEMA_PATH, 'utf-8'));
    expect(parsed.models.find((m) => m.name === 'Empty')!.fields).toEqual([]);
  });

  it('parse même une ligne "non parsable" quand ses deux premiers mots ressemblent à un champ', () => {
    // "this line has too many words and no type" matche quand même
    // ^(\w+)\s+(\w+)... : "this" devient le nom, "line" le type, le reste
    // tombe dans les attributs. Comportement réel du parser, pas un rejet.
    const parsed = parseSchemaContent(readFileSync(MALFORMED_SCHEMA_PATH, 'utf-8'));
    expect(parsed.models.find((m) => m.name === 'Broken')!.fields.map((f) => f.name)).toEqual(['id', 'this']);
  });

  it('ignore une ligne à un seul mot, faute de type détectable', () => {
    const parsed = parseSchemaContent('model T {\n  soloword\n}');
    expect(parsed.models[0].fields).toEqual([]);
  });
});

describe('parseSchemaContent — enums', () => {
  it('extrait les valeurs', () => {
    expect(schema.enums.get('Role')).toEqual(['USER', 'ADMIN', 'MODERATOR']);
  });

  it('ne traite pas un champ de type enum comme une relation', () => {
    expect(field('User', 'role').relation).toBeUndefined();
  });
});

describe('parseSchemaContent — drapeaux de champ', () => {
  it.each([
    ['id', { isId: true, isRequired: true, hasDefault: true, isList: false, isUnique: false }],
    ['email', { isId: false, isRequired: true, hasDefault: false, isList: false, isUnique: true }],
    ['name', { isId: false, isRequired: false, hasDefault: false, isList: false, isUnique: false }],
    ['rating', { isId: false, isRequired: false, hasDefault: false, isList: false, isUnique: false }],
    ['isActive', { isId: false, isRequired: true, hasDefault: true, isList: false, isUnique: false }],
    ['posts', { isId: false, isRequired: false, hasDefault: false, isList: true, isUnique: false }]
  ])('User.%s', (name, expected) => {
    expect(field('User', name)).toMatchObject(expected);
  });

  it('détecte @updatedAt', () => {
    expect(field('User', 'updatedAt').isUpdatedAt).toBe(true);
    expect(field('User', 'createdAt').isUpdatedAt).toBe(false);
  });

  it('détecte createdAt par le nom', () => {
    expect(field('User', 'createdAt').isCreatedAt).toBe(true);
  });

  it('détecte createdAt par @default(now()) sur un autre nom', () => {
    const parsed = parseSchemaContent('model T {\n  bornAt DateTime @default(now())\n}');
    expect(parsed.models[0].fields[0].isCreatedAt).toBe(true);
  });

  it('capture la valeur par défaut', () => {
    expect(field('User', 'role').defaultValue).toBe('USER');
    expect(field('User', 'name').defaultValue).toBeUndefined();
  });

  it('capture un défaut sous forme d’appel sans le tronquer', () => {
    // Avant correction, la regex /@default\s*\(([^)]+)\)/ s'arrêtait à la première
    // parenthèse fermante et capturait 'autoincrement(' ou 'now('.
    expect(field('User', 'id').defaultValue).toBe('autoincrement()');
    expect(field('User', 'createdAt').defaultValue).toBe('now()');
    expect(field('Post', 'id').defaultValue).toBe('cuid()');
  });

  it.each([
    ['a String @default("texte")', '"texte"'],
    ['a Int @default(0)', '0'],
    ['a Boolean @default(true)', 'true'],
    ['a String @default(uuid())', 'uuid()'],
    ['a String @default(dbgenerated("now"))', 'dbgenerated("now")']
  ])('capture %s', (line, expected) => {
    const parsed = parseSchemaContent(`model T {\n  ${line}\n}`);
    expect(parsed.models[0].fields[0].defaultValue).toBe(expected);
  });

  it('capture la doc /// du champ', () => {
    expect(field('Post', 'author').documentation).toBe('The author of the post');
  });

  it.each([
    ['Int', 'id'], ['String', 'email'], ['Boolean', 'isActive'], ['Decimal', 'balance'],
    ['BigInt', 'visits'], ['Float', 'rating'], ['Json', 'metadata'], ['Bytes', 'avatar'],
    ['DateTime', 'createdAt']
  ])('type %s', (type, name) => {
    expect(field('User', name).type).toBe(type);
  });
});

describe('parseSchemaContent — relations', () => {
  it('parse name, fields et references', () => {
    expect(field('Post', 'author').relation).toEqual({
      name: 'AuthorPosts', model: 'User', fields: ['authorId'], references: ['id']
    });
  });

  it('traite un type non scalaire sans @relation comme une relation', () => {
    expect(field('User', 'posts').relation).toEqual({ model: 'Post' });
    expect(field('Post', 'categories').relation).toEqual({ model: 'Category' });
  });

  it('ne traite pas la clé étrangère scalaire comme une relation', () => {
    expect(field('Post', 'authorId').relation).toBeUndefined();
    expect(field('Post', 'authorId').type).toBe('Int');
  });

  it('gère une relation sans argument nommé', () => {
    const parsed = parseSchemaContent(
      'model A {\n  bId Int\n  b B @relation(fields: [bId], references: [id])\n}'
    );
    expect(parsed.models[0].fields[1].relation).toEqual({ model: 'B', fields: ['bId'], references: ['id'] });
  });
});

describe('parseSchemaContent — limitation connue', () => {
  it('interrompt la capture du modèle sur une accolade dans une valeur par défaut', () => {
    // La regex de corps de modèle utilise [^}]+ : le } de "{}" clôt la capture.
    // Comportement documenté, non corrigé (hors périmètre).
    const parsed = parseSchemaContent('model T {\n  a Json @default("{}")\n  b String\n}');
    expect(parsed.models[0].fields.map((f) => f.name)).toEqual(['a']);
  });
});

describe('parsePrismaSchema', () => {
  it('lit un fichier existant', () => {
    expect(parsePrismaSchema(FULL_SCHEMA_PATH).models).toHaveLength(3);
  });

  it('lève sur un fichier absent', () => {
    expect(() => parsePrismaSchema('/nope/schema.prisma')).toThrow();
  });
});

describe('getDisplayFields', () => {
  const names = getDisplayFields(model('User')).map((f) => f.name);

  it('exclut les champs sensibles par nom', () => {
    expect(names).not.toContain('password');
  });

  it.each([
    'hashedPassword',
    'passwordHash',
    'apiSecret',
    'tokenHash',
    // 'token' seul : le README annonce ce filtre, et ces trois noms sont les
    // porteurs habituels d'un identifiant de session réutilisable.
    'apiToken',
    'accessToken',
    'refreshToken'
  ])('exclut %s', (name) => {
    const parsed = parseSchemaContent(`model T {\n  id Int @id\n  ${name} String\n}`);
    expect(getDisplayFields(parsed.models[0]).map((f) => f.name)).toEqual(['id']);
  });

  it('exclut les champs liste', () => {
    expect(names).not.toContain('posts');
  });

  it('exclut la relation portant fields', () => {
    expect(getDisplayFields(model('Post')).map((f) => f.name)).not.toContain('author');
  });

  it('conserve les scalaires ordinaires', () => {
    expect(names).toContain('email');
    expect(names).toContain('createdAt');
  });
});

describe('detectPivotTable', () => {
  it('détecte les tables implicites Prisma (préfixe _)', () => {
    const parsed = parseSchemaContent(`
      model _UserToRole {
        A Int
        B Int
      }
    `);
    expect(parsed.models[0].isPivotTable).toBe(true);
  });

  it('détecte les tables de liaison explicites avec FK uniquement', () => {
    const parsed = parseSchemaContent(`
      model UserRole {
        id     Int  @id @default(autoincrement())
        userId Int
        roleId Int
        user   User @relation(fields: [userId], references: [id])
        role   Role @relation(fields: [roleId], references: [id])
      }
      model User { id Int @id }
      model Role { id Int @id }
    `);
    expect(parsed.models.find(m => m.name === 'UserRole')?.isPivotTable).toBe(true);
  });

  it('détecte les tables de liaison avec timestamps', () => {
    const parsed = parseSchemaContent(`
      model ProjectMember {
        id        Int      @id @default(autoincrement())
        projectId Int
        userId    Int
        project   Project  @relation(fields: [projectId], references: [id])
        user      User     @relation(fields: [userId], references: [id])
        createdAt DateTime @default(now())
      }
      model Project { id Int @id }
      model User { id Int @id }
    `);
    expect(parsed.models.find(m => m.name === 'ProjectMember')?.isPivotTable).toBe(true);
  });

  it('ne détecte PAS les modèles normaux comme pivot tables', () => {
    const parsed = parseSchemaContent(`
      model User {
        id        Int      @id @default(autoincrement())
        email     String   @unique
        name      String
        bio       String?
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
      }
    `);
    expect(parsed.models[0].isPivotTable).toBe(false);
  });

  it('ne détecte PAS les modèles avec des champs métier comme pivot tables', () => {
    const parsed = parseSchemaContent(`
      model Membership {
        id        Int      @id @default(autoincrement())
        userId    Int
        teamId    Int
        role      String
        status    String
        user      User     @relation(fields: [userId], references: [id])
        team      Team     @relation(fields: [teamId], references: [id])
      }
      model User { id Int @id }
      model Team { id Int @id }
    `);
    // Has role and status business fields, so NOT a pivot table
    expect(parsed.models.find(m => m.name === 'Membership')?.isPivotTable).toBe(false);
  });

  it('détecte les pivot tables avec un seul champ metadata supplémentaire', () => {
    const parsed = parseSchemaContent(`
      model TeamUser {
        id        Int      @id @default(autoincrement())
        userId    Int
        teamId    Int
        joinedAt  DateTime @default(now())
        user      User     @relation(fields: [userId], references: [id])
        team      Team     @relation(fields: [teamId], references: [id])
      }
      model User { id Int @id }
      model Team { id Int @id }
    `);
    // joinedAt is a timestamp, only 1 "extra" field is allowed
    expect(parsed.models.find(m => m.name === 'TeamUser')?.isPivotTable).toBe(true);
  });
});

