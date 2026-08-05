/**
 * SvelteKit Admin - Main entry point
 */

// Core admin factory
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
} from './lib/admin.js';

// Server utilities
export * from './lib/server/introspection/index.js';
export * from './lib/server/crud/index.js';
export * from './lib/server/auth/index.js';

// Re-export components for direct import
export { AdminLayout, DataTable, AdminForm } from './lib/components/index.js';
