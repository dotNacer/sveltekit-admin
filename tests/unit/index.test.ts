import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from '../../src/lib/index.js';

/**
 * Épingle la surface publique du paquet. Les exports de type (`AdminHandlerConfig`,
 * `PrismaSchema`, `PrismaModel`, `PrismaField`) n'ont aucune présence à l'exécution :
 * seules les quatre fonctions doivent apparaître ici. Toute addition ou suppression
 * dans `src/lib/index.ts` fait échouer ce test — c'est voulu, la surface publiée est
 * un contrat.
 */
const RUNTIME_EXPORTS = [
  'createAdminHandler',
  'defaultAdminCheck',
  'parsePrismaSchema',
  'parseSchemaContent'
] as const;

const TYPE_ONLY_EXPORTS = [
  'AdminHandlerConfig',
  'PrismaSchema',
  'PrismaModel',
  'PrismaField'
] as const;

afterEach(() => vi.restoreAllMocks());

describe('surface publique du paquet', () => {
  it('n’exporte à l’exécution que les quatre fonctions attendues', () => {
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
  });
});
