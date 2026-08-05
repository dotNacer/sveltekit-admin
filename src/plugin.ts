/**
 * SvelteKit Admin - Vite Plugin
 * Injects admin routes into the SvelteKit app
 */

import type { Plugin, ViteDevServer } from 'vite';
import { parsePrismaSchema, type PrismaSchema } from './lib/server/introspection/parser.js';
import type { AdminAuthConfig } from './lib/server/auth/guard.js';

export interface ModelConfig {
  /** Fields to hide from all views */
  hidden?: string[];
  /** Fields that cannot be edited */
  readonly?: string[];
  /** Fields to show in list view (default: auto-detect) */
  listFields?: string[];
  /** Custom label for the model */
  label?: string;
  /** Custom icon (Lucide icon name) */
  icon?: string;
}

export interface SvelteKitAdminConfig {
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
  /** Base path for admin routes (default: /admin) */
  basePath?: string;
  /** Authentication configuration */
  auth?: AdminAuthConfig;
  /** Per-model configuration */
  models?: Record<string, ModelConfig>;
  /** Models to exclude from admin */
  exclude?: string[];
  /** Custom branding */
  branding?: {
    title?: string;
    logo?: string;
    primaryColor?: string;
  };
}

const VIRTUAL_MODULE_ID = 'virtual:sveltekit-admin';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

const VIRTUAL_CONFIG_ID = 'virtual:sveltekit-admin/config';
const RESOLVED_VIRTUAL_CONFIG_ID = '\0' + VIRTUAL_CONFIG_ID;

const VIRTUAL_SCHEMA_ID = 'virtual:sveltekit-admin/schema';
const RESOLVED_VIRTUAL_SCHEMA_ID = '\0' + VIRTUAL_SCHEMA_ID;

export function svelteKitAdmin(config: SvelteKitAdminConfig = {}): Plugin {
  const {
    prismaSchemaPath = './prisma/schema.prisma',
    basePath = '/admin',
    auth = { provider: 'better-auth' },
    models = {},
    exclude = [],
    branding = {}
  } = config;

  let schema: PrismaSchema | null = null;
  let server: ViteDevServer;

  return {
    name: 'sveltekit-admin',
    enforce: 'pre',

    configResolved() {
      // Parse Prisma schema on startup
      try {
        schema = parsePrismaSchema(prismaSchemaPath);
      } catch (e) {
        console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
      }
    },

    configureServer(_server) {
      server = _server;

      // Watch Prisma schema for changes
      server.watcher.add(prismaSchemaPath);
      server.watcher.on('change', (path) => {
        if (path.endsWith('schema.prisma')) {
          try {
            schema = parsePrismaSchema(prismaSchemaPath);
            // Invalidate virtual modules
            const configModule = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_CONFIG_ID);
            const schemaModule = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_SCHEMA_ID);
            if (configModule) server.moduleGraph.invalidateModule(configModule);
            if (schemaModule) server.moduleGraph.invalidateModule(schemaModule);
            server.ws.send({ type: 'full-reload' });
          } catch (e) {
            console.warn('[sveltekit-admin] Error reloading schema:', e);
          }
        }
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
      if (id === VIRTUAL_CONFIG_ID) return RESOLVED_VIRTUAL_CONFIG_ID;
      if (id === VIRTUAL_SCHEMA_ID) return RESOLVED_VIRTUAL_SCHEMA_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        return `
          export { default as AdminLayout } from 'sveltekit-admin/components/AdminLayout.svelte';
          export { default as DataTable } from 'sveltekit-admin/components/DataTable.svelte';
          export { default as AdminForm } from 'sveltekit-admin/components/AdminForm.svelte';
        `;
      }

      if (id === RESOLVED_VIRTUAL_CONFIG_ID) {
        const filteredModels = schema?.models.filter(m => !exclude.includes(m.name)) || [];
        
        return `
          export const config = ${JSON.stringify({
            basePath,
            auth,
            models,
            branding: {
              title: branding.title || 'Admin',
              logo: branding.logo,
              primaryColor: branding.primaryColor || '#6366f1'
            }
          })};
          
          export const modelNames = ${JSON.stringify(filteredModels.map(m => m.name))};
        `;
      }

      if (id === RESOLVED_VIRTUAL_SCHEMA_ID) {
        const filteredModels = schema?.models.filter(m => !exclude.includes(m.name)) || [];
        
        return `
          export const schema = ${JSON.stringify({
            models: filteredModels,
            enums: schema?.enums ? Object.fromEntries(schema.enums) : {}
          })};
        `;
      }

      return null;
    }
  };
}

/**
 * SvelteKit handle hook for admin auth
 */
export function createAdminHandle(config: SvelteKitAdminConfig = {}) {
  const basePath = config.basePath || '/admin';
  const adminRole = config.auth?.adminRole || 'admin';

  return async ({ event, resolve }: { event: any; resolve: Function }) => {
    // Only check admin routes
    if (!event.url.pathname.startsWith(basePath)) {
      return resolve(event);
    }

    // Skip login page
    if (event.url.pathname === `${basePath}/login`) {
      return resolve(event);
    }

    // Check authentication
    const session = event.locals.session;
    const user = event.locals.user;

    if (!session || !user) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${basePath}/login` }
      });
    }

    // Check admin role
    const isAdmin = config.auth?.adminCheck
      ? await config.auth.adminCheck(user)
      : user.role === adminRole || user.isAdmin === true;

    if (!isAdmin) {
      return new Response('Forbidden', { status: 403 });
    }

    return resolve(event);
  };
}

export default svelteKitAdmin;
