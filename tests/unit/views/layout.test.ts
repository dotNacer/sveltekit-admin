import { describe, it, expect } from 'vitest';
import { baseLayout } from '../../../src/lib/server/views/layout.js';

const models = [{ name: 'User', label: 'Users' }, { name: 'Post', label: 'Posts' }];

describe('baseLayout', () => {
  it('applique le branding fourni', () => {
    const html = baseLayout('X', { prisma: {}, branding: { title: 'T', primaryColor: '#ff0000' } } as any, models);
    expect(html).toContain('<title>T</title>');
    expect(html).toContain('--ska-primary: #ff0000');
  });

  it('applique les valeurs par défaut sans branding', () => {
    const html = baseLayout('X', { prisma: {} } as any, models);
    expect(html).toContain('<title>Admin</title>');
    expect(html).toContain('--ska-primary: #6366f1');
  });

  it('utilise le basePath fourni', () => {
    const html = baseLayout('X', { prisma: {}, basePath: '/back' } as any, models);
    expect(html).toContain('href="/back/user"');
  });

  it('utilise /admin par défaut sans basePath', () => {
    const html = baseLayout('X', { prisma: {} } as any, models);
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/post"');
  });

  it('marque le dashboard actif sans modèle courant', () => {
    const html = baseLayout('X', { prisma: {} } as any, models);
    expect(html).toMatch(/href="\/admin" class="ska-nav__link ska-nav__link--active"/);
  });

  it('marque le modèle courant actif, insensible à la casse', () => {
    const html = baseLayout('X', { prisma: {} } as any, models, 'user');
    expect(html).toMatch(/href="\/admin\/user" class="ska-nav__link ska-nav__link--active"/);
    expect(html).not.toMatch(/href="\/admin" class="ska-nav__link ska-nav__link--active"/);
  });

  it('injecte le contenu', () => {
    expect(baseLayout('<p>hello</p>', { prisma: {} } as any, models)).toContain('<p>hello</p>');
  });

  it('gère une liste de modèles vide', () => {
    const html = baseLayout('X', { prisma: {} } as any, []);
    expect(html).toContain('ska-nav');
  });
});
