import { describe, it, expect } from 'vitest';
import { dashboardView } from '../../../src/lib/server/views/dashboard.js';

describe('dashboardView', () => {
  const models = [{ name: 'User', label: 'Users', count: 3 }, { name: 'Post', label: 'Posts', count: 0 }];

  it('affiche les statistiques', () => {
    const html = dashboardView(models, { total: 3, models: 2 }, '/admin');
    expect(html).toContain('>2</div>');
    expect(html).toContain('>3</div>');
  });

  it('affiche une carte par modèle avec son lien', () => {
    const html = dashboardView(models, { total: 3, models: 2 }, '/admin');
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/post"');
    expect(html).toContain('0 records');
  });

  it('gère l’absence de modèle', () => {
    const html = dashboardView([], { total: 0, models: 0 }, '/admin');
    expect(html).toContain('ska-models');
    expect(html).not.toContain('ska-model-card"');
  });
});
