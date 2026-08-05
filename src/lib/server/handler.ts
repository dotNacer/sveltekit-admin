/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { parsePrismaSchema, type PrismaSchema } from './introspection/parser.js';
import { escapeHtml, toLabel, formatValue } from './views/html.js';
import { baseLayout } from './views/layout.js';

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
// HTML Templates
// ============================================

function dashboardView(models: Array<{ name: string; label: string; count: number }>, stats: { total: number; models: number }, basePath: string): string {
  return `
    <h1>Dashboard</h1>
    <p class="ska-subtitle">Welcome to your admin panel</p>
    
    <div class="ska-stats">
      <div class="ska-stat">
        <div class="ska-stat__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/></svg>
        </div>
        <div>
          <div class="ska-stat__value">${stats.models}</div>
          <div class="ska-stat__label">Models</div>
        </div>
      </div>
      <div class="ska-stat">
        <div class="ska-stat__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
        </div>
        <div>
          <div class="ska-stat__value">${stats.total}</div>
          <div class="ska-stat__label">Total Records</div>
        </div>
      </div>
    </div>
    
    <h2>Models</h2>
    <div class="ska-models">
      ${models.map(m => `
        <a href="${basePath}/${m.name.toLowerCase()}" class="ska-model-card">
          <div>
            <div class="ska-model-card__name">${m.label}</div>
            <div class="ska-model-card__count">${m.count} records</div>
          </div>
          <div class="ska-model-card__footer">Manage →</div>
        </a>
      `).join('')}
    </div>
  `;
}

function listView(
  model: { name: string; label: string; fields: any[]; primaryKey: string },
  items: any[],
  pagination: { page: number; perPage: number; total: number },
  basePath: string,
  config: AdminHandlerConfig
): string {
  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  const listFields = modelConfig.listFields;
  
  let displayFields = model.fields.filter(f => 
    !hidden.includes(f.name) && 
    !f.relation &&
    !['Json', 'Bytes'].includes(f.type)
  );
  
  if (listFields?.length) {
    displayFields = displayFields.filter(f => listFields.includes(f.name));
  }
  
  displayFields = displayFields.slice(0, 6);

  const totalPages = Math.ceil(pagination.total / pagination.perPage);

  return `
    <div class="ska-header">
      <div>
        <h1>${model.label}</h1>
        <p class="ska-subtitle">${pagination.total} records</p>
      </div>
      <a href="${basePath}/${model.name.toLowerCase()}/new" class="ska-btn ska-btn--primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Add ${model.label}
      </a>
    </div>
    
    <div class="ska-card">
      <div class="ska-table-wrap">
        <table class="ska-table">
          <thead>
            <tr>
              ${displayFields.map(f => `<th>${toLabel(f.name)}</th>`).join('')}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.length === 0 ? `
              <tr><td colspan="${displayFields.length + 1}" style="text-align: center; color: #64748b; padding: 2rem;">No records found</td></tr>
            ` : items.map(item => `
              <tr>
                ${displayFields.map(f => `<td>${formatValue(item[f.name], f.type)}</td>`).join('')}
                <td class="ska-table__actions">
                  <a href="${basePath}/${model.name.toLowerCase()}/${item[model.primaryKey]}" class="ska-btn ska-btn--secondary ska-btn--sm">Edit</a>
                  <form method="POST" action="${basePath}/${model.name.toLowerCase()}/${item[model.primaryKey]}" style="display:inline" onsubmit="return confirm('Delete this item?')">
                    <input type="hidden" name="_action" value="delete">
                    <button type="submit" class="ska-btn ska-btn--danger ska-btn--sm">Delete</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      ${totalPages > 1 ? `
        <div class="ska-pagination">
          <span class="ska-pagination__info">
            Showing ${(pagination.page - 1) * pagination.perPage + 1} to ${Math.min(pagination.page * pagination.perPage, pagination.total)} of ${pagination.total}
          </span>
          ${pagination.page > 1 ? `<a href="?page=${pagination.page - 1}" class="ska-btn ska-btn--secondary ska-btn--sm">Previous</a>` : ''}
          ${pagination.page < totalPages ? `<a href="?page=${pagination.page + 1}" class="ska-btn ska-btn--secondary ska-btn--sm">Next</a>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function createView(
  model: { name: string; label: string; fields: any[]; primaryKey: string },
  basePath: string,
  config: AdminHandlerConfig,
  error?: string
): string {
  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  
  const formFields = model.fields.filter(f => 
    !hidden.includes(f.name) &&
    !f.isId &&
    !f.isCreatedAt &&
    !f.isUpdatedAt &&
    !f.relation &&
    !f.hasDefault
  );

  return `
    <a href="${basePath}/${model.name.toLowerCase()}" class="ska-back">← Back to list</a>
    <h1>Create ${model.label}</h1>
    
    ${error ? `<div class="ska-alert ska-alert--error">${error}</div>` : ''}
    
    <div class="ska-card">
      <form method="POST" class="ska-form">
        <input type="hidden" name="_action" value="create">
        ${formFields.map(f => fieldInput(f, null, false)).join('')}
        <div class="ska-form__actions">
          <button type="submit" class="ska-btn ska-btn--primary">Create</button>
          <a href="${basePath}/${model.name.toLowerCase()}" class="ska-btn ska-btn--secondary">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

function editView(
  model: { name: string; label: string; fields: any[]; primaryKey: string },
  item: any,
  basePath: string,
  config: AdminHandlerConfig,
  error?: string
): string {
  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  const readonly = modelConfig.readonly || [];
  
  const formFields = model.fields.filter(f => 
    !hidden.includes(f.name) &&
    !f.relation
  );

  const id = item[model.primaryKey];

  return `
    <a href="${basePath}/${model.name.toLowerCase()}" class="ska-back">← Back to list</a>
    <h1>Edit ${model.label}</h1>
    <p class="ska-subtitle">ID: ${escapeHtml(String(id))}</p>
    
    ${error ? `<div class="ska-alert ska-alert--error">${error}</div>` : ''}
    
    <div class="ska-card">
      <form method="POST" class="ska-form">
        <input type="hidden" name="_action" value="update">
        ${formFields.map(f => fieldInput(f, item[f.name], f.isId || f.isCreatedAt || f.isUpdatedAt || readonly.includes(f.name))).join('')}
        <div class="ska-form__actions">
          <button type="submit" class="ska-btn ska-btn--primary">Save Changes</button>
          <a href="${basePath}/${model.name.toLowerCase()}" class="ska-btn ska-btn--secondary">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

function fieldInput(field: any, value: any, isReadonly: boolean): string {
  const label = toLabel(field.name);
  const required = field.isRequired && !field.hasDefault && !isReadonly;
  
  if (field.type === 'Boolean') {
    return `
      <div class="ska-field">
        <label class="ska-checkbox-wrap">
          <input type="checkbox" name="${field.name}" class="ska-checkbox" ${value ? 'checked' : ''} ${isReadonly ? 'disabled' : ''}>
          <span class="ska-label">${label}</span>
        </label>
      </div>
    `;
  }

  let inputType = 'text';
  let inputValue = value ?? '';
  
  switch (field.type) {
    case 'Int':
    case 'Float':
    case 'Decimal':
    case 'BigInt':
      inputType = 'number';
      break;
    case 'DateTime':
      inputType = 'datetime-local';
      if (value) {
        inputValue = new Date(value).toISOString().slice(0, 16);
      }
      break;
    case 'Json':
      return `
        <div class="ska-field">
          <label class="ska-label">${label}${required ? ' *' : ''}</label>
          <textarea name="${field.name}" class="ska-input" rows="4" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>${value ? escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>
        </div>
      `;
  }

  // Handle String fields that might be long
  if (field.type === 'String' && (field.name.includes('description') || field.name.includes('content') || field.name.includes('body'))) {
    return `
      <div class="ska-field">
        <label class="ska-label">${label}${required ? ' *' : ''}</label>
        <textarea name="${field.name}" class="ska-input" rows="4" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>${escapeHtml(String(inputValue))}</textarea>
      </div>
    `;
  }

  return `
    <div class="ska-field">
      <label class="ska-label">${label}${required ? ' *' : ''}</label>
      <input type="${inputType}" name="${field.name}" value="${escapeHtml(String(inputValue))}" class="ska-input" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>
    </div>
  `;
}

function notFoundView(message: string): string {
  return `
    <h1>Not Found</h1>
    <p class="ska-subtitle">${escapeHtml(message)}</p>
    <a href="" class="ska-btn ska-btn--secondary">← Back to Dashboard</a>
  `;
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
