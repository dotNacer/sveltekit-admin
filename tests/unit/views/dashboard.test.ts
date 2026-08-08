import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Dashboard from '../../../src/lib/server/views/Dashboard.svelte';

const renderDashboard = (models: any[], stats: any, basePath = '/admin') =>
  render(Dashboard, { props: { models, stats, basePath } }).body;

describe('Dashboard.svelte', () => {
  const models = [{ name: 'User', label: 'Users', count: 3 }, { name: 'Post', label: 'Posts', count: 0 }];

  it('affiche les statistiques', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    expect(html).toContain('>2</div>');
    expect(html).toContain('>3</div>');
  });

  it('affiche une carte par modèle avec son lien', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/post"');
    expect(html).toContain('0 records');
  });

  it('échappe le libellé fourni par la configuration', () => {
    const html = renderDashboard([{ name: 'User', label: '<b>U', count: 1 }], { total: 1, models: 1 });
    expect(html).toContain('&lt;b>U');
    expect(html).not.toContain('<b>U');
  });

  it('gère l’absence de modèle', () => {
    const html = renderDashboard([], { total: 0, models: 0 });
    expect(html).toContain('ska-models');
    expect(html).not.toContain('ska-model-card"');
  });
});
