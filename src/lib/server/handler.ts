/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { parsePrismaSchema, type PrismaSchema } from './introspection/parser.js';
import { escapeHtml, toLabel } from './views/html.js';
import { baseLayout } from './views/layout.js';
import { dashboardView } from './views/dashboard.js';
import { listView } from './views/list.js';
import { createView, editView } from './views/form.js';
import { notFoundView } from './views/notFound.js';

export interface AdminHandlerConfig {
  /** Prisma client instance */
  prisma: any;
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
  /** Base path for admin routes (default: /admin) */
  basePath?: string;
  /** Authentication check - return true if user can access admin */
  authCheck?: (event: any) => boolean | Promise<boolean>;
  /** Per-model configuration */
  models?: Record<string, {
    hidden?: string[];
    readonly?: string[];
    listFields?: string[];
    label?: string;
    icon?: string;
  }>;
  /** Models to exclude from admin */
  exclude?: string[];
  /** Custom branding */
  branding?: {
    title?: string;
    logo?: string;
    primaryColor?: string;
  };
}

interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit';
  model?: string;
  id?: string;
}

function parseRoute(pathname: string, basePath: string): ParsedRoute {
  const path = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, '');
  
  if (!path) {
    return { view: 'dashboard' };
  }

  const segments = path.split('/').filter(Boolean);

  if (segments.length === 1) {
    return { view: 'list', model: segments[0] };
  }

  if (segments.length === 2) {
    if (segments[1] === 'new') {
      return { view: 'create', model: segments[0] };
    }
    return { view: 'edit', model: segments[0], id: segments[1] };
  }

  return { view: 'dashboard' };
}

function toPrismaModel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

// ============================================
// Main Handler
// ============================================

export function createAdminHandler(config: AdminHandlerConfig) {
  const {
    prisma,
    prismaSchemaPath = './prisma/schema.prisma',
    basePath = '/admin',
    authCheck,
    exclude = [],
    models: modelsConfig = {},
    branding = {}
  } = config;

  // Parse schema once at startup
  let schema: PrismaSchema | null = null;
  try {
    schema = parsePrismaSchema(prismaSchemaPath);
  } catch (e) {
    console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
  }

  const filteredModels = schema?.models.filter(m => !exclude.includes(m.name)) || [];
  
  const modelList = filteredModels.map(m => ({
    name: m.name,
    label: modelsConfig[m.name]?.label || toLabel(m.name)
  }));

  return async ({ event, resolve }: { event: any; resolve: Function }) => {
    const { pathname } = event.url;

    // Only handle admin routes
    if (!pathname.startsWith(basePath)) {
      return resolve(event);
    }

    // Auth check
    if (authCheck) {
      const allowed = await authCheck(event);
      if (!allowed) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    const route = parseRoute(pathname, basePath);
    let content = '';
    let currentModel: string | undefined;

    try {
      // Handle POST requests (create, update, delete)
      if (event.request.method === 'POST') {
        const formData = await event.request.formData();
        const action = formData.get('_action');
        
        if (route.model) {
          const schemaModel = filteredModels.find(m => m.name.toLowerCase() === route.model?.toLowerCase());
          if (!schemaModel) {
            throw new Error(`Model "${route.model}" not found`);
          }
          
          const prismaModelName = toPrismaModel(schemaModel.name);
          const primaryKey = schemaModel.fields.find(f => f.isId)?.name || 'id';
          
          if (action === 'delete' && route.id) {
            const parsedId = /^\d+$/.test(route.id) ? parseInt(route.id) : route.id;
            await prisma[prismaModelName].delete({
              where: { [primaryKey]: parsedId }
            });
            
            return new Response(null, {
              status: 303,
              headers: { Location: `${basePath}/${route.model.toLowerCase()}` }
            });
          }
          
          if (action === 'create' || action === 'update') {
            const data: Record<string, any> = {};
            
            for (const field of schemaModel.fields) {
              if (field.isId || field.isUpdatedAt || field.isCreatedAt || field.relation) continue;
              
              const value = formData.get(field.name);
              if (value === null) {
                if (field.type === 'Boolean') {
                  data[field.name] = false;
                }
                continue;
              }
              
              switch (field.type) {
                case 'Int':
                case 'BigInt':
                  data[field.name] = value ? parseInt(value.toString()) : null;
                  break;
                case 'Float':
                case 'Decimal':
                  data[field.name] = value ? parseFloat(value.toString()) : null;
                  break;
                case 'Boolean':
                  data[field.name] = value === 'on' || value === 'true' || value === '1';
                  break;
                case 'DateTime':
                  data[field.name] = value ? new Date(value.toString()) : null;
                  break;
                case 'Json':
                  try {
                    data[field.name] = value ? JSON.parse(value.toString()) : null;
                  } catch {
                    data[field.name] = null;
                  }
                  break;
                default:
                  data[field.name] = value.toString();
              }
            }
            
            if (action === 'create') {
              await prisma[prismaModelName].create({ data });
            } else if (route.id) {
              const parsedId = /^\d+$/.test(route.id) ? parseInt(route.id) : route.id;
              await prisma[prismaModelName].update({
                where: { [primaryKey]: parsedId },
                data
              });
            }
            
            return new Response(null, {
              status: 303,
              headers: { Location: `${basePath}/${route.model.toLowerCase()}` }
            });
          }
        }
      }

      // GET requests - render views
      if (route.view === 'dashboard') {
        const modelsWithCounts = await Promise.all(
          filteredModels.map(async m => {
            const prismaModelName = toPrismaModel(m.name);
            let count = 0;
            try {
              count = await prisma[prismaModelName].count();
            } catch (e) {}
            return {
              name: m.name,
              label: modelsConfig[m.name]?.label || toLabel(m.name),
              count
            };
          })
        );
        
        const totalRecords = modelsWithCounts.reduce((sum, m) => sum + m.count, 0);
        
        content = dashboardView(modelsWithCounts, { total: totalRecords, models: modelsWithCounts.length }, basePath);
      }
      
      else if (route.view === 'list' && route.model) {
        currentModel = route.model;
        const schemaModel = filteredModels.find(m => m.name.toLowerCase() === route.model?.toLowerCase());
        
        if (!schemaModel) {
          content = notFoundView(`Model "${route.model}" not found`);
        } else {
          const prismaModelName = toPrismaModel(schemaModel.name);
          const primaryKey = schemaModel.fields.find(f => f.isId)?.name || 'id';
          
          const page = parseInt(event.url.searchParams.get('page') || '1');
          const perPage = 20;
          
          const [items, total] = await Promise.all([
            prisma[prismaModelName].findMany({
              skip: (page - 1) * perPage,
              take: perPage,
              orderBy: { [primaryKey]: 'desc' }
            }),
            prisma[prismaModelName].count()
          ]);
          
          content = listView(
            {
              name: schemaModel.name,
              label: modelsConfig[schemaModel.name]?.label || toLabel(schemaModel.name),
              fields: schemaModel.fields,
              primaryKey
            },
            items,
            { page, perPage, total },
            basePath,
            config
          );
        }
      }
      
      else if (route.view === 'create' && route.model) {
        currentModel = route.model;
        const schemaModel = filteredModels.find(m => m.name.toLowerCase() === route.model?.toLowerCase());
        
        if (!schemaModel) {
          content = notFoundView(`Model "${route.model}" not found`);
        } else {
          const primaryKey = schemaModel.fields.find(f => f.isId)?.name || 'id';
          
          content = createView(
            {
              name: schemaModel.name,
              label: modelsConfig[schemaModel.name]?.label || toLabel(schemaModel.name),
              fields: schemaModel.fields,
              primaryKey
            },
            basePath,
            config
          );
        }
      }
      
      else if (route.view === 'edit' && route.model && route.id) {
        currentModel = route.model;
        const schemaModel = filteredModels.find(m => m.name.toLowerCase() === route.model?.toLowerCase());
        
        if (!schemaModel) {
          content = notFoundView(`Model "${route.model}" not found`);
        } else {
          const prismaModelName = toPrismaModel(schemaModel.name);
          const primaryKey = schemaModel.fields.find(f => f.isId)?.name || 'id';
          const parsedId = /^\d+$/.test(route.id) ? parseInt(route.id) : route.id;
          
          const item = await prisma[prismaModelName].findUnique({
            where: { [primaryKey]: parsedId }
          });
          
          if (!item) {
            content = notFoundView(`${schemaModel.name} with ID "${route.id}" not found`);
          } else {
            content = editView(
              {
                name: schemaModel.name,
                label: modelsConfig[schemaModel.name]?.label || toLabel(schemaModel.name),
                fields: schemaModel.fields,
                primaryKey
              },
              item,
              basePath,
              config
            );
          }
        }
      }

    } catch (e: any) {
      console.error('[sveltekit-admin] Error:', e);
      content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }

    const html = baseLayout(content, config, modelList, currentModel);
    
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  };
}
