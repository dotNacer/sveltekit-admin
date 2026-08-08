import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Layout from '../../../src/lib/server/views/Layout.svelte';

const models = [{ name: 'User', label: 'Users' }, { name: 'Post', label: 'Posts' }];

const renderLayout = (
  content: string,
  config: any,
  modelList = models,
  currentModel?: string
) => render(Layout, { props: { content, config, modelList, currentModel } }).body;

const navItems = (html: string) =>
  (html.match(/<li class="ska-nav__item">/g) ?? []).length;

describe('Layout.svelte', () => {
  it('applique le branding fourni', () => {
    const html = renderLayout('X', { prisma: {}, branding: { title: 'T', primaryColor: '#ff0000' } });
    expect(html).toContain('<title>T</title>');
    expect(html).toContain('--ska-primary: #ff0000');
  });

  it('applique les valeurs par défaut sans branding', () => {
    const html = renderLayout('X', { prisma: {} });
    expect(html).toContain('<title>Admin</title>');
    expect(html).toContain('--ska-primary: #6366f1');
  });

  it('utilise le basePath fourni', () => {
    const html = renderLayout('X', { prisma: {}, basePath: '/back' });
    expect(html).toContain('href="/back/user"');
  });

  it('utilise /admin par défaut sans basePath', () => {
    const html = renderLayout('X', { prisma: {} });
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/post"');
  });

  it('marque le dashboard actif sans modèle courant', () => {
    const html = renderLayout('X', { prisma: {} });
    expect(html).toMatch(/href="\/admin" class="ska-nav__link ska-nav__link--active"/);
  });

  it('marque le modèle courant actif, insensible à la casse', () => {
    const html = renderLayout('X', { prisma: {} }, models, 'user');
    expect(html).toMatch(/href="\/admin\/user"[\s\S]*?class="ska-nav__link ska-nav__link--active"/);
    expect(html).not.toMatch(/href="\/admin" class="ska-nav__link ska-nav__link--active"/);
  });

  it('injecte le contenu', () => {
    expect(renderLayout('<p>hello</p>', { prisma: {} })).toContain('<p>hello</p>');
  });

  it('gère une liste de modèles vide', () => {
    expect(navItems(renderLayout('X', { prisma: {} }, []))).toBe(1);
  });

  it('rend un item de nav par modèle', () => {
    expect(navItems(renderLayout('X', { prisma: {} }))).toBe(3);
  });

  it('échappe les libellés fournis par la configuration', () => {
    const html = renderLayout('X', { prisma: {}, branding: { title: '<b>T' } }, [
      { name: 'User', label: '<i>U' }
    ]);
    expect(html).toContain('&lt;b>T');
    expect(html).toContain('&lt;i>U');
    expect(html).not.toContain('<i>U');
  });
});
