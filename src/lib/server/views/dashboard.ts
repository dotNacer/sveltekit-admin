import { escapeHtml } from './html.js';

export function dashboardView(models: Array<{ name: string; label: string; count: number }>, stats: { total: number; models: number }, basePath: string): string {
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
            <div class="ska-model-card__name">${escapeHtml(m.label)}</div>
            <div class="ska-model-card__count">${m.count} records</div>
          </div>
          <div class="ska-model-card__footer">Manage →</div>
        </a>
      `).join('')}
    </div>
  `;
}
