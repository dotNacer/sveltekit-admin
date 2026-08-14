import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from '../../src/lib/index.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

/**
 * Épingle la surface publique du paquet. Les exports de type (`AdminHandlerConfig`,
 * `PrismaSchema`, `PrismaModel`, `PrismaField`, `Schema`, `Model`, `Field`, `DataAdapter`,
 * `SchemaIntrospector`, `Filter`) n'ont aucune présence à l'exécution : seules les cinq
 * fonctions doivent apparaître ici. Toute addition ou suppression dans `src/lib/index.ts`
 * fait échouer ce test — c'est voulu, la surface publiée est un contrat.
 */
const RUNTIME_EXPORTS = [
  'createAdminHandler',
  'defaultAdminCheck',
  'parsePrismaSchema',
  'parseSchemaContent',
  'createPrismaAdapter'
] as const;

const TYPE_ONLY_EXPORTS = [
  'AdminHandlerConfig',
  'PrismaSchema',
  'PrismaModel',
  'PrismaField',
  'Schema',
  'Model',
  'Field',
  'DataAdapter',
  'SchemaIntrospector',
  'Filter'
] as const;

afterEach(() => vi.restoreAllMocks());

describe('surface publique du paquet', () => {
  it('n’exporte à l’exécution que les cinq fonctions attendues', () => {
    expect(Object.keys(api).sort()).toEqual([...RUNTIME_EXPORTS].sort());
  });

  it.each(RUNTIME_EXPORTS)('expose %s comme fonction', (name) => {
    expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(TYPE_ONLY_EXPORTS)('n’émet aucune valeur pour le type %s', (name) => {
    expect(name in api).toBe(false);
  });

  it('expose des fonctions réellement utilisables', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.parseSchemaContent('model User {\n  id Int @id\n}').models[0].name).toBe('User');
    expect(typeof api.createAdminHandler({ prisma: {}, prismaSchemaPath: '/nope.prisma' })).toBe(
      'function'
    );
    expect(
      typeof api.createPrismaAdapter({ prisma: {}, schemaPath: FULL_SCHEMA_PATH }).data.listRecords
    ).toBe('function');
  });

  it('createAdminHandler est le wrapper Prisma, pas le core', () => {
    const src = readFileSync(new URL('../../src/lib/index.ts', import.meta.url), 'utf8');
    expect(src).toContain("from './server/adapters/prisma/handler.js'");
    expect(src).not.toMatch(
      /export \{ createAdminHandler.*\} from '\.\/server\/handler\.js'/
    );
  });
});
