import type { AdminHandlerConfig } from '../handler.js';
import { adjustColor } from './html.js';

export function baseLayout(content: string, config: AdminHandlerConfig, models: Array<{ name: string; label: string }>, currentModel?: string): string {
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
