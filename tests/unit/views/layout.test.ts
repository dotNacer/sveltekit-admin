import { describe, it, expect } from 'vitest';
import { baseLayout } from '../../../src/lib/server/views/layout.js';

const models = [{ name: 'User', label: 'Users' }, { name: 'Post', label: 'Posts' }];

/** Nombre d'items de nav rendus, item Dashboard statique inclus. */
const navItems = (html: string) =>
  (html.match(/<li class="ska-nav__item">/g) ?? []).length;

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
    // Seul l'item Dashboard, statique, subsiste : la boucle de modèles ne rend
    // rien. L'ancienne assertion (`toContain('ska-nav')`) était vraie quoi qu'il
    // arrive, `.ska-nav` étant déclaré dans le CSS inline du layout.
    expect(navItems(baseLayout('X', { prisma: {} } as any, []))).toBe(1);
  });

  it('rend un item de nav par modèle', () => {
    expect(navItems(baseLayout('X', { prisma: {} } as any, models))).toBe(3);
  });

  it('échappe les libellés fournis par la configuration', () => {
    const html = baseLayout('X', { prisma: {}, branding: { title: '<b>T' } } as any, [
      { name: 'User', label: '<i>U' }
    ]);
    expect(html).toContain('<title>&lt;b&gt;T</title>');
    expect(html).toContain('&lt;i&gt;U');
    expect(html).not.toContain('<i>U');
  });
});
