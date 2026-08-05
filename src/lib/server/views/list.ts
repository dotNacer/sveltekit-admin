import type { AdminHandlerConfig } from '../handler.js';
import type { ViewModel } from './types.js';
import { toLabel, formatValue } from './html.js';

export function listView(
  model: ViewModel,
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
