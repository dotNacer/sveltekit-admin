import { createPrismaIntrospector } from './introspector.js';
import { createPrismaDataAdapter } from './dataAdapter.js';
import type { SchemaIntrospector, DataAdapter } from '../types.js';
import type { Schema } from '../../types/schema.js';

export { compileFilterToPrismaWhere } from './filterCompiler.js';

/**
 * `mode: 'insensitive'` is only valid Prisma-side on postgresql/cockroachdb/
 * mongodb — emitting it on sqlite/mysql/sqlserver is a hard Prisma error.
 * `schema` is `null` when introspection failed (the caller degraded
 * gracefully instead of throwing) — in that case `'auto'` can never detect a
 * supported provider, so it resolves to `false`, same as today.
 */
export function resolveCaseInsensitiveSearch(
  schema: Schema | null,
  searchMode: 'auto' | 'insensitive' | 'default' = 'auto'
): boolean {
  return (
    searchMode === 'insensitive' ||
    (searchMode === 'auto' && ['postgresql', 'cockroachdb', 'mongodb'].includes(schema?.provider ?? ''))
  );
}

/**
 * Builds a ready-to-use Prisma adapter. Introspects eagerly (throws
 * immediately on a bad `schemaPath`) — this is the explicit-construction
 * path (`createAdminHandler({ adapter: createPrismaAdapter(...) })`), where
 * failing loud on a caller's own mistake is correct. `createAdminHandler`'s
 * OWN legacy `{ prisma, prismaSchemaPath }` path does NOT call this function
 * — it builds the introspector/data pair itself so it can keep degrading
 * gracefully to "no models known" on a bad path, exactly as it always has.
 */
export function createPrismaAdapter(opts: {
  prisma: any;
  schemaPath: string;
  searchMode?: 'auto' | 'insensitive' | 'default';
}): { introspector: SchemaIntrospector; data: DataAdapter } {
  const introspector = createPrismaIntrospector({ schemaPath: opts.schemaPath });
  const schema = introspector.introspect() as Schema;
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(schema, opts.searchMode);
  return {
    introspector: { introspect: () => schema }, // memoized: introspect() already ran once above
    data: createPrismaDataAdapter(opts.prisma, { caseInsensitiveSearch })
  };
}
