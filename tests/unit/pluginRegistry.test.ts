import { describe, it, expect } from 'vitest';
import { BUILTIN_ROUTES } from '../../src/lib/server/router.js';
import {
  resolvePluginRegistry,
  actionsForModel,
  pluginViewId
} from '../../src/lib/server/pluginRegistry.js';
import type { AdminPlugin } from '../../src/lib/server/plugin.js';

const models = [{ name: 'User' }, { name: 'Post' }];

const page = (over: Partial<AdminPlugin> = {}): AdminPlugin => ({
  name: 'fake-graph',
  pages: [{ pattern: [':model', ':id', 'graph'], render: async () => ({ html: 'x' }) }],
  ...over
});

describe('pluginViewId', () => {
  it('joins name and pattern', () => {
    expect(pluginViewId('fake-graph', [':model', ':id', 'graph'])).toBe(
      'plugin/fake-graph/:model/:id/graph'
    );
  });
});

describe('resolvePluginRegistry', () => {
  it('registre vide si plugins = []', () => {
    const reg = resolvePluginRegistry([], BUILTIN_ROUTES, models);
    expect(reg.routes).toEqual([]);
    expect(reg.pagesByView.size).toBe(0);
    expect(reg.recordActions).toEqual([]);
  });

  it('enregistre une page après les builtins (ordre plugins puis pages)', () => {
    const a: AdminPlugin = {
      name: 'a',
      pages: [{ pattern: [':model', ':id', 'graph'], render: async () => ({ html: 'a' }) }]
    };
    const b: AdminPlugin = {
      name: 'b',
      pages: [{ pattern: ['hello'], render: async () => ({ html: 'b' }) }]
    };
    const reg = resolvePluginRegistry([a, b], BUILTIN_ROUTES, models);
    expect(reg.routes.map((r) => r.view)).toEqual([
      pluginViewId('a', [':model', ':id', 'graph']),
      pluginViewId('b', ['hello'])
    ]);
    expect(reg.pagesByView.get(pluginViewId('a', [':model', ':id', 'graph']))).toBe(a.pages![0]);
  });

  it('concatène recordActions dans l’ordre plugins puis interne', () => {
    const a: AdminPlugin = {
      name: 'a',
      recordActions: [
        { label: 'A1', href: () => '/a1' },
        { label: 'A2', href: () => '/a2' }
      ]
    };
    const b: AdminPlugin = {
      name: 'b',
      recordActions: [{ label: 'B1', href: () => '/b1' }]
    };
    const reg = resolvePluginRegistry([a, b], BUILTIN_ROUTES, models);
    expect(reg.recordActions.map((x) => x.label)).toEqual(['A1', 'A2', 'B1']);
  });

  it('throw si name vide', () => {
    expect(() => resolvePluginRegistry([{ name: '', pages: [] }], BUILTIN_ROUTES, models)).toThrow(
      /plugin name must be a non-empty string/
    );
  });

  it('throw si name dupliqué', () => {
    expect(() =>
      resolvePluginRegistry([page({ name: 'x' }), page({ name: 'x' })], BUILTIN_ROUTES, models)
    ).toThrow(/duplicate plugin name "x"/);
  });

  it.each([
    { pattern: [] as string[], label: 'dashboard' },
    { pattern: ['_search'], label: '_search' },
    { pattern: ['_logout'], label: '_logout' },
    { pattern: [':model'], label: 'list' },
    { pattern: [':model', 'new'], label: 'create' },
    { pattern: [':model', ':id'], label: 'edit' }
  ])('throw overlay builtin $label', ({ pattern }) => {
    expect(() =>
      resolvePluginRegistry(
        [{ name: 'x', pages: [{ pattern, render: async () => ({ html: '' }) }] }],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/overlays builtin route/);
  });

  it('throw collision de pattern entre deux plugins', () => {
    const p = [':model', ':id', 'graph'];
    expect(() =>
      resolvePluginRegistry(
        [
          { name: 'one', pages: [{ pattern: p, render: async () => ({ html: '1' }) }] },
          { name: 'two', pages: [{ pattern: p, render: async () => ({ html: '2' }) }] }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/collides with plugin "one"/);
  });

  it('throw collision de pattern dans le même plugin', () => {
    const p = [':model', ':id', 'graph'];
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'one',
            pages: [
              { pattern: p, render: async () => ({ html: '1' }) },
              { pattern: p, render: async () => ({ html: '2' }) }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/collides with plugin "one"/);
  });

  it('throw token :foo', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: [':model', ':id', ':foo'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/":foo" is not :model or :id/);
  });

  it('throw models[] inconnu sur une page', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [
              {
                pattern: [':model', ':id', 'graph'],
                models: ['Nope'],
                render: async () => ({ html: '' })
              }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/unknown model "Nope"/);
  });

  it('throw models[] inconnu sur une action', () => {
    expect(() =>
      resolvePluginRegistry(
        [{ name: 'x', recordActions: [{ label: 'G', models: ['Nope'], href: () => '/' }] }],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/unknown model "Nope"/);
  });

  it('accepte models[] insensible à la casse', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [
              {
                pattern: [':model', ':id', 'graph'],
                models: ['user'],
                render: async () => ({ html: '' })
              }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).not.toThrow();
  });

  it('throw models[] sur une page sans :model', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: ['hello'], models: ['User'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/sets models\[\] but pattern has no :model/);
  });

  it('throw :id sans :model', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: ['hello', ':id'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/:id but pattern has no :model/);
  });

  it('plugin no-op (ni pages ni actions) est autorisé', () => {
    expect(() => resolvePluginRegistry([{ name: 'noop' }], BUILTIN_ROUTES, models)).not.toThrow();
  });
});

describe('actionsForModel', () => {
  it('filtre par models[] insensible à la casse ; omit = tous', () => {
    const reg = resolvePluginRegistry(
      [
        {
          name: 'x',
          recordActions: [
            { label: 'All', href: () => '/all' },
            { label: 'User only', models: ['user'], href: () => '/u' },
            { label: 'Post only', models: ['Post'], href: () => '/p' }
          ]
        }
      ],
      BUILTIN_ROUTES,
      models
    );
    expect(actionsForModel(reg, 'User').map((a) => a.label)).toEqual(['All', 'User only']);
    expect(actionsForModel(reg, 'Post').map((a) => a.label)).toEqual(['All', 'Post only']);
  });
});
