import { resolve } from 'node:path';

export const FULL_SCHEMA_PATH = resolve('tests/fixtures/schemas/full.prisma');
export const MALFORMED_SCHEMA_PATH = resolve('tests/fixtures/schemas/malformed.prisma');

export interface PrismaCall {
  model: string;
  method: string;
  args: unknown;
}

export interface PrismaMock {
  calls: PrismaCall[];
  [model: string]: any;
}

type MethodOverride = (args: unknown) => unknown;

/**
 * Fabrique un client Prisma mocké.
 * `data` : enregistrements par clé de modèle Prisma (camelCase), ex. { user: [{ id: 1 }] }
 * `overrides` : remplace une méthode, ex. { user: { count: () => { throw new Error('boom'); } } }
 */
export function createPrismaMock(
  data: Record<string, unknown[]> = {},
  overrides: Record<string, Record<string, MethodOverride>> = {}
): PrismaMock {
  const calls: PrismaCall[] = [];
  const mock: PrismaMock = { calls };

  for (const modelKey of new Set([...Object.keys(data), ...Object.keys(overrides)])) {
    const records = data[modelKey] ?? [];
    const ov = overrides[modelKey] ?? {};

    const wrap = (method: string, impl: MethodOverride) => (args: unknown) => {
      calls.push({ model: modelKey, method, args });
      return (ov[method] ?? impl)(args);
    };

    mock[modelKey] = {
      findMany: wrap('findMany', (args: any) => {
        const skip = args?.skip ?? 0;
        const take = args?.take ?? records.length;
        return Promise.resolve(records.slice(skip, skip + take));
      }),
      findUnique: wrap('findUnique', (args: any) => {
        const entries = Object.entries(args?.where ?? {});
        if (entries.length === 0) return Promise.resolve(null);
        const [[key, value]] = entries;
        return Promise.resolve(records.find((r: any) => r[key] === value) ?? null);
      }),
      count: wrap('count', () => Promise.resolve(records.length)),
      create: wrap('create', (args: any) => Promise.resolve(args.data)),
      update: wrap('update', (args: any) => Promise.resolve(args.data)),
      delete: wrap('delete', () => Promise.resolve(undefined))
    };
  }

  return mock;
}

/** Filtre les appels journalisés, pour assertion. */
export function callsTo(mock: PrismaMock, model: string, method: string): PrismaCall[] {
  return mock.calls.filter((c) => c.model === model && c.method === method);
}
