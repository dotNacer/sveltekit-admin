import type { AdminPlugin } from '../../src/lib/server/plugin.js';

export function fakeGraphPlugin(opts: { models?: string[] } = {}): AdminPlugin {
  const models = opts.models ?? ['User'];
  return {
    name: 'fake-graph',
    pages: [
      {
        pattern: [':model', ':id', 'graph'],
        models,
        render: (ctx) => ({
          html: `<div class="ska-fake-graph">${ctx.escapeHtml(JSON.stringify(ctx.record ?? null))}</div>`,
          styles: '.ska-fake-graph{color:red}',
          scripts: 'window.__skaFakeGraph=1'
        })
      }
    ],
    recordActions: [
      {
        label: 'Graph',
        models,
        href: ({ model, id, basePath }) => `${basePath}/${model.toLowerCase()}/${id}/graph`
      }
    ]
  };
}
