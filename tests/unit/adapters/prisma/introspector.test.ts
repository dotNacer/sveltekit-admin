import { describe, it, expect } from 'vitest';
import { createPrismaIntrospector } from '../../../../src/lib/server/adapters/prisma/introspector.js';
import { parsePrismaSchema } from '../../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH, MALFORMED_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

describe('createPrismaIntrospector', () => {
  it('introspect() renvoie exactement ce que produirait parsePrismaSchema directement', () => {
    const introspector = createPrismaIntrospector({ schemaPath: FULL_SCHEMA_PATH });
    expect(introspector.introspect()).toEqual(parsePrismaSchema(FULL_SCHEMA_PATH));
  });

  it("propage une erreur de parsing (fichier absent) au lieu de l'avaler", () => {
    const introspector = createPrismaIntrospector({ schemaPath: '/does/not/exist.prisma' });
    expect(() => introspector.introspect()).toThrow();
  });

  it('un schéma syntaxiquement dégradé ne lève pas — mêmes garanties que parsePrismaSchema', () => {
    const introspector = createPrismaIntrospector({ schemaPath: MALFORMED_SCHEMA_PATH });
    expect(() => introspector.introspect()).not.toThrow();
  });
});
