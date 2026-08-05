/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { parsePrismaSchema, type PrismaSchema } from './introspection/parser.js';

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

function toLabel(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}

function toPrismaModel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

// ============================================
// HTML Templates
// ============================================

function baseLayout(content: string, config: AdminHandlerConfig, models: Array<{ name: string; label: string }>, currentModel?: string): string {
  const { branding = {} } = config;
  const title = branding.title || 'Admin';
  const primaryColor = branding.primaryColor || '#6366f1';
  const basePath = config.basePath || '/admin';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --ska-primary: ${primaryColor};
      --ska-primary-hover: ${adjustColor(primaryColor, -15)};
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.5;
    }
    
    .ska-layout {
      display: flex;
      min-height: 100vh;
    }
    
    .ska-sidebar {
      width: 260px;
      background: white;
      border-right: 1px solid #e2e8f0;
      padding: 1.5rem;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
    }
    
    .ska-logo {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--ska-primary);
      text-decoration: none;
      display: block;
      margin-bottom: 2rem;
    }
    
    .ska-nav { list-style: none; }
    
    .ska-nav__item {
      margin-bottom: 0.25rem;
    }
    
    .ska-nav__link {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.875rem;
      color: #64748b;
      text-decoration: none;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      transition: all 0.15s;
    }
    
    .ska-nav__link:hover {
      background: #f1f5f9;
      color: #1e293b;
    }
    
    .ska-nav__link--active {
      background: #eef2ff;
      color: var(--ska-primary);
      font-weight: 500;
    }
    
    .ska-main {
      flex: 1;
      margin-left: 260px;
      padding: 2rem;
    }
    
    .ska-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 1.5rem;
    }
    
    .ska-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 0.375rem;
      border: none;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;
    }
    
    .ska-btn--primary {
      background: var(--ska-primary);
      color: white;
    }
    
    .ska-btn--primary:hover {
      background: var(--ska-primary-hover);
    }
    
    .ska-btn--secondary {
      background: #f1f5f9;
      color: #475569;
    }
    
    .ska-btn--secondary:hover {
      background: #e2e8f0;
    }
    
    .ska-btn--danger {
      background: #fef2f2;
      color: #dc2626;
    }
    
    .ska-btn--danger:hover {
      background: #fee2e2;
    }
    
    .ska-btn--sm {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
    }
    
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
    
    .ska-subtitle { color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem; }
    
    /* Table styles */
    .ska-table-wrap { overflow-x: auto; }
    
    .ska-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    
    .ska-table th {
      text-align: left;
      padding: 0.75rem 1rem;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      font-weight: 600;
      color: #64748b;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .ska-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .ska-table tr:hover {
      background: #f8fafc;
    }
    
    .ska-table__actions {
      display: flex;
      gap: 0.5rem;
    }
    
    /* Form styles */
    .ska-form { max-width: 600px; }
    
    .ska-field {
      margin-bottom: 1.25rem;
    }
    
    .ska-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
      margin-bottom: 0.375rem;
    }
    
    .ska-input {
      width: 100%;
      padding: 0.625rem 0.875rem;
      font-size: 0.875rem;
      border: 1px solid #d1d5db;
      border-radius: 0.375rem;
      transition: all 0.15s;
    }
    
    .ska-input:focus {
      outline: none;
      border-color: var(--ska-primary);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    
    .ska-input[readonly] {
      background: #f9fafb;
      color: #6b7280;
    }
    
    .ska-checkbox-wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .ska-checkbox {
      width: 1rem;
      height: 1rem;
    }
    
    .ska-form__actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid #e2e8f0;
    }
    
    /* Stats grid */
    .ska-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    
    .ska-stat {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .ska-stat__icon {
      width: 3rem;
      height: 3rem;
      background: #eef2ff;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ska-primary);
    }
    
    .ska-stat__value {
      font-size: 1.5rem;
      font-weight: 700;
    }
    
    .ska-stat__label {
      font-size: 0.875rem;
      color: #64748b;
    }
    
    /* Models grid */
    .ska-models {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    
    .ska-model-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 1.25rem;
      text-decoration: none;
      transition: all 0.15s;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 100px;
    }
    
    .ska-model-card:hover {
      border-color: var(--ska-primary);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    
    .ska-model-card__name {
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 0.25rem;
    }
    
    .ska-model-card__count {
      font-size: 0.75rem;
      color: #64748b;
    }
    
    .ska-model-card__footer {
      color: var(--ska-primary);
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    /* Header with actions */
    .ska-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1.5rem;
    }
    
    /* Pagination */
    .ska-pagination {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #e2e8f0;
    }
    
    .ska-pagination__info {
      font-size: 0.875rem;
      color: #64748b;
      margin-right: auto;
    }
    
    /* Search */
    .ska-search {
      margin-bottom: 1rem;
    }
    
    .ska-search__input {
      padding: 0.5rem 1rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      width: 300px;
    }
    
    /* Back link */
    .ska-back {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: #64748b;
      text-decoration: none;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }
    
    .ska-back:hover { color: #475569; }
    
    /* Alert */
    .ska-alert {
      padding: 1rem;
      border-radius: 0.375rem;
      margin-bottom: 1rem;
    }
    
    .ska-alert--error {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }
    
    .ska-alert--success {
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbf7d0;
    }
  </style>
</head>
<body>
  <div class="ska-layout">
    <aside class="ska-sidebar">
      <a href="${basePath}" class="ska-logo">${title}</a>
      <nav>
        <ul class="ska-nav">
          <li class="ska-nav__item">
            <a href="${basePath}" class="ska-nav__link ${!currentModel ? 'ska-nav__link--active' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Dashboard
            </a>
          </li>
          ${models.map(m => `
          <li class="ska-nav__item">
            <a href="${basePath}/${m.name.toLowerCase()}" class="ska-nav__link ${currentModel?.toLowerCase() === m.name.toLowerCase() ? 'ska-nav__link--active' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
              ${m.label}
            </a>
          </li>
          `).join('')}
        </ul>
      </nav>
    </aside>
    <main class="ska-main">
      ${content}
    </main>
  </div>
</body>
</html>`;
}

function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

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

function formatValue(value: any, type: string): string {
  if (value === null || value === undefined) return '<span style="color:#94a3b8">—</span>';
  
  if (type === 'DateTime') {
    return new Date(value).toLocaleString();
  }
  
  if (type === 'Boolean') {
    return value ? '✓' : '✗';
  }
  
  const str = String(value);
  if (str.length > 50) {
    return escapeHtml(str.slice(0, 50)) + '...';
  }
  
  return escapeHtml(str);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
          content = notFoundView(`Model "${decodeURIComponent(route.model)}" not found`);
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
          content = notFoundView(`Model "${decodeURIComponent(route.model)}" not found`);
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
          content = notFoundView(`Model "${decodeURIComponent(route.model)}" not found`);
        } else {
          const prismaModelName = toPrismaModel(schemaModel.name);
          const primaryKey = schemaModel.fields.find(f => f.isId)?.name || 'id';
          const parsedId = /^\d+$/.test(route.id) ? parseInt(route.id) : route.id;
          
          const item = await prisma[prismaModelName].findUnique({
            where: { [primaryKey]: parsedId }
          });
          
          if (!item) {
            content = notFoundView(`${schemaModel.name} with ID "${decodeURIComponent(route.id)}" not found`);
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
