import { resolve } from 'node:path';

export const FULL_SCHEMA_PATH = resolve('tests/fixtures/schemas/full.prisma');
export const MALFORMED_SCHEMA_PATH = resolve('tests/fixtures/schemas/malformed.prisma');
export const PIVOT_SCHEMA_PATH = resolve('tests/fixtures/schemas/pivot.prisma');
export const RELATIONS_SCHEMA_PATH = resolve('tests/fixtures/schemas/relations.prisma');
export const SEARCH_SCHEMA_PATH = resolve('tests/fixtures/schemas/search.prisma');

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
 * Évalue un `where` Prisma sur UNE entrée. Récursif pour supporter `AND`/`OR`
 * (utilisés par la composition de `buildWhere`, voir query/listQuery.ts) et
 * les opérateurs `in`, `contains`, `startsWith`, `gte`, `lte`, `equals`, `not`
 * — les seuls émis par le code applicatif de ce projet. `mode: 'insensitive'`
 * est un no-op ici : la comparaison `contains`/`startsWith` du mock est déjà
 * insensible à la casse, donc l'émettre ou pas ne change rien au résultat
 * (fidèle au comportement réel de Prisma sur Postgres avec ce mode).
 */
function matchesWhere(record: any, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  const w = where as Record<string, unknown>;

  if ('AND' in w) {
    return (w.AND as unknown[]).every((clause) => matchesWhere(record, clause));
  }
  if ('OR' in w) {
    return (w.OR as unknown[]).some((clause) => matchesWhere(record, clause));
  }

  return Object.entries(w).every(([field, condition]) => {
    const value = record[field];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('contains' in c) {
        return String(value ?? '').toLowerCase().includes(String(c.contains).toLowerCase());
      }
      if ('startsWith' in c) {
        return String(value ?? '').toLowerCase().startsWith(String(c.startsWith).toLowerCase());
      }
      if ('gte' in c) return (toComparable(value) as any) >= (toComparable(c.gte) as any);
      if ('lte' in c) return (toComparable(value) as any) <= (toComparable(c.lte) as any);
      if ('lt' in c) return (toComparable(value) as any) < (toComparable(c.lt) as any);
      if ('equals' in c) return value === c.equals;
      if ('not' in c) return value !== c.not;
    }
    return value === condition;
  });
}

/** Normalise une valeur pour une comparaison d'ordre (`gte`/`lte`/`lt`) : Date -> ms, sinon telle quelle. */
function toComparable(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v;
}

/** Égalité simple sur toutes les entrées du where (délègue à `matchesWhere` pour AND/OR/opérateurs). */
function filterByWhere(records: unknown[], where: unknown): unknown[] {
  if (!where || (typeof where === 'object' && Object.keys(where).length === 0)) return records;
  return records.filter((r) => matchesWhere(r, where));
}

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
        const filtered = filterByWhere(records, args?.where);
        const skip = args?.skip ?? 0;
        const take = args?.take ?? filtered.length;
        return Promise.resolve(filtered.slice(skip, skip + take));
      }),
      findUnique: wrap('findUnique', (args: any) => {
        const entries = Object.entries(args?.where ?? {});
        if (entries.length === 0) return Promise.resolve(null);
        const [[key, value]] = entries;
        return Promise.resolve(records.find((r: any) => r[key] === value) ?? null);
      }),
      findFirst: wrap('findFirst', (args: any) =>
        Promise.resolve(filterByWhere(records, args?.where)[0] ?? null)
      ),
      count: wrap('count', (args: any) =>
        Promise.resolve(filterByWhere(records, args?.where).length)
      ),
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
