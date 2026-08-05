/**
 * SvelteKit Admin
 * Django-like admin panel for SvelteKit + Prisma
 */

// Core admin factory and loaders
export {
  createAdmin,
  createLayoutLoad,
  createDashboardLoad,
  createModelListLoad,
  createModelNewLoad,
  createModelNewAction,
  createModelEditLoad,
  createModelEditAction,
  createModelDeleteAction,
  createAdminGuard,
  type AdminConfig,
  type AdminContext
} from './admin.js';

// Prisma introspection utilities
export {
  parsePrismaSchema,
  parseSchemaContent,
  getDisplayFields,
  getEditableFields,
  getInputType,
  fieldToLabel,
  type PrismaSchema,
  type PrismaModel,
  type PrismaField
} from './server/introspection/parser.js';

// CRUD operations
export {
  createListOperation,
  createGetOperation,
  createCreateOperation,
  createUpdateOperation,
  createDeleteOperation,
  buildSearchWhere,
  buildFilterWhere,
  type ListOptions,
  type ListResult
} from './server/crud/operations.js';

// Auth utilities
export {
  createAuthGuard,
  defaultAdminCheck,
  type AdminAuthConfig,
  type AdminSession
} from './server/auth/guard.js';

// Re-export components
export { default as AdminLayout } from './components/AdminLayout.svelte';
export { default as DataTable } from './components/DataTable.svelte';
export { default as AdminForm } from './components/AdminForm.svelte';
