import type { AdminHandlerConfig } from '../handler.js';
import type { ViewModel } from './types.js';
import { getDisplayFields } from '../introspection/parser.js';
import { escapeHtml, toLabel, formatValue } from './html.js';

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
  
  // `getDisplayFields` retire les champs au nom sensible (password/hash/secret/token),
  // comme le README l'annonce : sans cet appel, un projet qui ne déclare pas
  // `hidden: ['password']` publiait ses empreintes de mot de passe en colonne.
  //
  // Le filtre ne s'applique qu'aux champs NON nommés dans `listFields` : la
  // correspondance se fait par sous-chaîne, donc elle attrape aussi des noms
  // anodins (`hashtag`, `tokenCount`, `secretariat`). Sans cette échappatoire, ces
  // colonnes deviendraient impossibles à afficher, et surtout impossibles à
  // déboguer. Nommer un champ dans `listFields` est une intention explicite, et
  // elle gagne ; l'absence de configuration reste protégée par défaut.
  const explicit = new Set(listFields ?? []);
  const safeNames = new Set(getDisplayFields(model).map(f => f.name));

  let displayFields = model.fields.filter(f =>
    (explicit.has(f.name) || safeNames.has(f.name)) &&
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
        <h1>${escapeHtml(model.label)}</h1>
        <p class="ska-subtitle">${pagination.total} records</p>
      </div>
      <a href="${basePath}/${model.name.toLowerCase()}/new" class="ska-btn ska-btn--primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Add ${escapeHtml(model.label)}
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
            ` : items.map(item => {
              // La PK vient de la base : elle est échappée avant d'entrer dans un attribut.
              const pk = escapeHtml(String(item[model.primaryKey]));
              return `
              <tr>
                ${displayFields.map(f => `<td>${formatValue(item[f.name], f.type)}</td>`).join('')}
                <td class="ska-table__actions">
                  <a href="${basePath}/${model.name.toLowerCase()}/${pk}" class="ska-btn ska-btn--secondary ska-btn--sm">Edit</a>
                  <form method="POST" action="${basePath}/${model.name.toLowerCase()}/${pk}" style="display:inline" onsubmit="return confirm('Delete this item?')">
                    <input type="hidden" name="_action" value="delete">
                    <button type="submit" class="ska-btn ska-btn--danger ska-btn--sm">Delete</button>
                  </form>
                </td>
              </tr>
            `;
            }).join('')}
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
