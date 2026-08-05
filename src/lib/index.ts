/**
 * SvelteKit Admin
 * Django-like admin panel for SvelteKit + Prisma
 */

export { createAdminHandler, type AdminHandlerConfig } from './server/handler.js';
export { defaultAdminCheck } from './server/auth.js';
export {
  parsePrismaSchema,
  parseSchemaContent,
  type PrismaSchema,
  type PrismaModel,
  type PrismaField
} from './server/introspection/parser.js';
