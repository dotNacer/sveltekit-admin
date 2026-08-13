/** Wraps the existing regex-based `.prisma` file parser behind `SchemaIntrospector`. */
import { parsePrismaSchema } from '../../introspection/parser.js';
import type { SchemaIntrospector } from '../types.js';

export function createPrismaIntrospector(opts: { schemaPath: string }): SchemaIntrospector {
  return {
    introspect() {
      return parsePrismaSchema(opts.schemaPath);
    }
  };
}
