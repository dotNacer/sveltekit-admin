import { describe, it, expect } from 'vitest';
import { parseRoute, matchRoute, BUILTIN_ROUTES } from '../../src/lib/server/router.js';

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
    ['/admin/post/ckabc123', { view: 'edit', model: 'post', id: 'ckabc123' }],
    ['/admin/_logout', { view: 'logout' }],
    // `_logout` n'est spécial qu'en position racine à un segment : un
    // modèle nommé littéralement `_logout` (improbable mais possible en
    // théorie) resterait dispatché en `list`/`edit` normalement dès qu'il
    // y a un deuxième segment — seule la route à un segment est réservée.
    ['/admin/_logout/1', { view: 'edit', model: '_logout', id: '1' }]
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

describe('matchRoute extra pattern (plugin seam, not on parseRoute)', () => {
  const routes = [
    ...BUILTIN_ROUTES,
    { pattern: [':model', ':id', 'graph'], view: 'graph' }
  ];

  it('matches /admin/user/1/graph when the extra entry is registered', () => {
    expect(matchRoute('/admin/user/1/graph', '/admin', routes)).toEqual({
      view: 'graph',
      model: 'user',
      id: '1'
    });
  });

  it('parseRoute on the same path stays notFound (builtin table only)', () => {
    expect(parseRoute('/admin/user/1/graph', '/admin')).toEqual({ view: 'notFound' });
  });

  it('still prefers create over edit for /user/new', () => {
    expect(matchRoute('/admin/user/new', '/admin', routes)).toEqual({
      view: 'create',
      model: 'user'
    });
  });
});
