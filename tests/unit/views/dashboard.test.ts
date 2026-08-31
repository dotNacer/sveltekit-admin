import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Dashboard from '../../../src/lib/server/views/Dashboard.svelte';
import type { DashboardRow } from '../../../src/lib/server/dashboard.js';

const renderDashboard = (
  rows: DashboardRow[],
  title = 'Dashboard',
  subtitle = 'Welcome to your admin panel'
) => render(Dashboard, { props: { rows, title, subtitle } }).body;

const card = (name: string, label: string, count: number) => ({
  name,
  label,
  count,
  href: `/admin/${name.toLowerCase()}`,
  newHref: `/admin/${name.toLowerCase()}/new`
});

const ROWS: DashboardRow[] = [
  {
    kind: 'cards',
    cards: [
      { value: 2, label: 'Models', icon: 'models' },
      { value: 3, label: 'Total Records', icon: 'records' }
    ]
  },
  { kind: 'models', title: 'Models', cards: [card('User', 'Users', 3), card('Post', 'Posts', 0)] }
];

describe('Dashboard.svelte', () => {
  it('affiche les statistiques', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('>2</div>');
    expect(html).toContain('>3</div>');
  });

  it('affiche une carte par modèle avec ses deux liens', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/user/new"');
    expect(html).toContain('href="/admin/post"');
    expect(html).toContain('0 records');
    expect(html).toContain('aria-label="New Users"');
  });

  it('échappe les libellés fournis par la configuration', () => {
    const html = renderDashboard(
      [{ kind: 'models', title: '<i>T', cards: [card('User', '<b>U', 1)] }],
      '<script>x',
      '<em>s'
    );
    expect(html).toContain('&lt;b>U');
    expect(html).toContain('&lt;i>T');
    expect(html).toContain('&lt;script>x');
    expect(html).toContain('&lt;em>s');
    expect(html).not.toContain('<b>U');
    expect(html).not.toContain('<em>s');
  });

  it('omet le titre de section quand il n’est pas configuré', () => {
    const html = renderDashboard([{ kind: 'models', cards: [card('User', 'Users', 1)] }]);
    expect(html).toContain('ska-dashboard__section');
    expect(html).not.toContain('<h2>');
  });

  it('rend une page vide sans widget', () => {
    const html = renderDashboard([]);
    expect(html).toContain('ska-dashboard__header');
    expect(html).not.toContain('ska-models');
  });

  it('structure la page en en-tête et en sections', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('ska-dashboard__header');
    expect(html).toContain('<section class="ska-dashboard__section"');
  });

  it('ne produit pas de lien imbriqué dans un lien', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('<article class="ska-model-card"');
    // `\s` après `<a` évite un faux positif sur `<article ...>` (« article »
    // commence aussi par la lettre « a »).
    expect(html).not.toMatch(/<a\s[^>]*class="ska-model-card"/);
  });
});
