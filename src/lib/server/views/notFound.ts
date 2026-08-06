import { escapeHtml } from './html.js';

export function notFoundView(message: string, basePath: string): string {
  return `
    <h1>Not Found</h1>
    <p class="ska-subtitle">${escapeHtml(message)}</p>
    <a href="${basePath}" class="ska-btn ska-btn--secondary">← Back to Dashboard</a>
  `;
}
