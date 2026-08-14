/**
 * SvelteKit Admin
 * Django-like admin panel for SvelteKit + Prisma
 */

export { createAdminHandler, type AdminHandlerConfig } from './server/adapters/prisma/handler.js';
export { defaultAdminCheck } from './server/auth.js';
export {
  parsePrismaSchema,
  parseSchemaContent,
  type PrismaSchema,
  type PrismaModel,
  type PrismaField
} from './server/introspection/parser.js';
export type { Schema, Model, Field } from './server/types/schema.js';
export { createPrismaAdapter } from './server/adapters/prisma/index.js';
export type { DataAdapter, SchemaIntrospector, Filter } from './server/adapters/types.js';
