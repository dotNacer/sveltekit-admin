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
    ['/admin/post/ckabc123', { view: 'edit', model: 'post', id: 'ckabc123' }],
    // Known defect (Task 15 will add a 'notFound' view): any path with 3+
    // segments silently falls through to the dashboard branch instead of
    // a 404. Asserted here on purpose to characterize current behaviour.
    ['/admin/user/1/edit', { view: 'dashboard' }],
    ['/admin/a/b/c/d', { view: 'dashboard' }]
  ])('%s', (pathname, expected) => {
    expect(parseRoute(pathname, '/admin')).toEqual(expected);
  });
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
