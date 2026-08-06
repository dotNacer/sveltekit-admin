import { describe, it, expect } from 'vitest';
import { parseRoute } from '../../src/lib/server/router.js';

describe('parseRoute avec basePath /admin', () => {
  it.each([
    ['/admin', { view: 'dashboard' }],
    ['/admin/', { view: 'dashboard' }],
    ['/admin///', { view: 'dashboard' }],
    ['/admin/user', { view: 'list', model: 'user' }],
    ['/admin/user/', { view: 'list', model: 'user' }],
    ['/admin/User', { view: 'list', model: 'User' }],
    ['/admin/user/new', { view: 'create', model: 'user' }],
    ['/admin/user/1', { view: 'edit', model: 'user', id: '1' }],
    ['/admin/post/ckabc123', { view: 'edit', model: 'post', id: 'ckabc123' }]
  ])('%s', (pathname, expected) => {
    expect(parseRoute(pathname, '/admin')).toEqual(expected);
  });

  // Un chemin de 3 segments ou plus ne correspond à aucune vue : il rendait
  // silencieusement le dashboard avant la variante 'notFound'.
  it.each(['/admin/user/1/edit', '/admin/a/b/c/d', '/admin/user/1/edit/'])(
    'renvoie notFound pour %s', (pathname) => {
      expect(parseRoute(pathname, '/admin')).toEqual({ view: 'notFound' });
    }
  );
});

describe('parseRoute avec basePath personnalisé', () => {
  it('gère un basePath imbriqué', () => {
    expect(parseRoute('/back/office/user/2', '/back/office')).toEqual({
      view: 'edit', model: 'user', id: '2'
    });
  });

  it('gère un basePath racine', () => {
    expect(parseRoute('/user', '')).toEqual({ view: 'list', model: 'user' });
  });

  it('préserve un id contenant des caractères encodés une fois décodés', () => {
    expect(parseRoute('/admin/user/a%20b', '/admin')).toEqual({
      view: 'edit', model: 'user', id: 'a%20b'
    });
  });
});
