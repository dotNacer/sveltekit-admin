import { describe, it, expect } from 'vitest';
import type { PluginPageContext } from '../../../../src/lib/server/plugin.js';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';
import { escapeHtml } from '../../../../src/lib/server/views/html.js';

describe('relationGraphPlugin', () => {
  it('returns name, graph pattern, Graph action, omitted models', () => {
    const plugin = relationGraphPlugin();
    expect(plugin.name).toBe('relation-graph');
    expect(plugin.pages).toHaveLength(1);
    expect(plugin.pages![0].pattern).toEqual([':model', ':id', 'graph']);
    expect(plugin.pages![0].models).toBeUndefined();
    expect(plugin.recordActions).toHaveLength(1);
    expect(plugin.recordActions![0].label).toBe('Graph');
    expect(plugin.recordActions![0].models).toBeUndefined();
    expect(plugin.recordActions![0].href({ model: 'User', id: 1, basePath: '/admin' })).toBe(
      '/admin/user/1/graph'
    );
  });

  it('forwards models onto page and action', () => {
    const plugin = relationGraphPlugin({ models: ['User'] });
    expect(plugin.pages![0].models).toEqual(['User']);
    expect(plugin.recordActions![0].models).toEqual(['User']);
  });

  it('forwards empty models array', () => {
    const plugin = relationGraphPlugin({ models: [] });
    expect(plugin.pages![0].models).toEqual([]);
  });

  it('throws on non-integer / out-of-range depth', () => {
    const msg = /relationGraphPlugin: depth must be an integer in 0\.\.8/;
    expect(() => relationGraphPlugin({ depth: -1 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: 9 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: 2.5 })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: NaN })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: Infinity })).toThrow(msg);
    expect(() => relationGraphPlugin({ depth: '2' as any })).toThrow(msg);
  });

  it('accepts depth 0 and 8', () => {
    expect(relationGraphPlugin({ depth: 0 }).name).toBe('relation-graph');
    expect(relationGraphPlugin({ depth: 8 }).name).toBe('relation-graph');
  });

  it('render callback walks and renders the graph page', async () => {
    const plugin = relationGraphPlugin();
    const ctx: PluginPageContext = {
      record: { id: 1, email: 'a@b.c' },
      route: { view: 'plugin/relation-graph/:model/:id/graph', model: 'user', id: '1' },
      basePath: '/admin',
      findModel: () => ({
        name: 'User',
        fields: [
          {
            name: 'id',
            type: 'Int',
            isId: true,
            isRequired: true,
            isList: false,
            isUnique: false,
            isUpdatedAt: false,
            isCreatedAt: false,
            hasDefault: false
          }
        ]
      }),
      relationGraph: null,
      resolveLabel: () => 'Ada',
      escapeHtml,
      loadRecord: async () => null,
      listRecords: async () => [],
      getM2mSelectedIds: async () => [],
      event: {},
      hiddenFieldsOf: () => new Set(),
      isSensitiveFieldName: () => false
    };

    const result = await plugin.pages![0].render(ctx);
    expect(result.html).toContain('ska-rg');
    expect(result.html).toContain('User · Ada');
    expect(typeof result.scripts).toBe('string');
    expect(result.scripts).toContain('.ska-rg-viewport');
  });
});
