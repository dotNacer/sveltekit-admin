import { adjustColor } from './html.js';

export function styles(primaryColor: string): string {
  return `
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
      display: flex;
      flex-direction: column;
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

    .ska-logout {
      margin-top: auto;
      padding-top: 1rem;
    }

    .ska-logout__btn {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: none;
      border: none;
      color: #64748b;
      font-size: 0.875rem;
      font-family: inherit;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.15s;
      text-align: left;
    }

    .ska-logout__btn:hover {
      background: #fef2f2;
      color: #dc2626;
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

    .ska-table th a.ska-th-sort {
      color: inherit;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .ska-table th a.ska-th-sort:hover { text-decoration: underline; }
    .ska-table th a.ska-th-sort:focus-visible {
      outline: 2px solid var(--ska-primary);
      outline-offset: 2px;
      border-radius: 2px;
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

    /* Sélecteur d'attribut et non une classe : aria-invalid est déjà la source
       de vérité pour les lecteurs d'écran, une classe parallèle finirait par en
       diverger. */
    .ska-input[aria-invalid='true'] {
      border-color: #dc2626;
    }

    .ska-input[aria-invalid='true']:focus {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
    }

    .ska-field__error {
      margin-top: 0.375rem;
      font-size: 0.8125rem;
      color: #b91c1c;
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

    .ska-checkbox-group {
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 0.75rem;
      max-height: 220px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .ska-related-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .ska-related-row:last-child { border-bottom: none; }

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

    /* Filter sidebar */
    .ska-filters {
      margin-bottom: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .ska-filters__group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.625rem;
    }

    .ska-filters__group + .ska-filters__group {
      padding-top: 0.75rem;
      border-top: 1px solid #f1f5f9;
    }

    .ska-filters__title {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      min-width: 88px;
      flex-shrink: 0;
    }

    .ska-filters__list {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .ska-filters__link {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.625rem;
      border-radius: 999px;
      border: 1px solid #e2e8f0;
      color: #475569;
      text-decoration: none;
      font-size: 0.8125rem;
      line-height: 1.25rem;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .ska-filters__link:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }

    .ska-filters__link--active {
      background: var(--ska-primary);
      border-color: var(--ska-primary);
      color: white;
      font-weight: 500;
    }

    .ska-filters__range,
    .ska-filters__select {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .ska-filters__range-input {
      padding: 0.25rem 0.5rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.25rem;
      font-size: 0.8125rem;
      width: 6.5rem;
    }

    .ska-filters__select-input {
      padding: 0.25rem 0.625rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.25rem;
      font-size: 0.8125rem;
      color: #475569;
      background: white;
      max-width: 220px;
    }

    .ska-filters__chip {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.5rem 0.25rem 0.625rem;
      border-radius: 999px;
      background: #eef2ff;
      color: var(--ska-primary);
      font-size: 0.8125rem;
    }

    .ska-filters__chip a {
      color: inherit;
      text-decoration: none;
    }

    .ska-filters__chip-clear {
      color: #64748b;
      text-decoration: none;
      line-height: 1;
    }

    .ska-filters__chip-clear:hover {
      color: #dc2626;
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
  `;
}
