import type { AdminPlugin, AdminPluginPage, AdminPluginRecordAction } from '../../plugin.js';
import { layout } from './layout.js';
import { renderGraphPage } from './render.js';
import { walk } from './walk.js';

export interface RelationGraphPluginOptions {
  models?: string[];
  depth?: number;
}

export function relationGraphPlugin(opts: RelationGraphPluginOptions = {}): AdminPlugin {
  const depth = opts.depth === undefined ? 2 : opts.depth;
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) {
    throw new Error('[sveltekit-admin] relationGraphPlugin: depth must be an integer in 0..8');
  }

  const page: AdminPluginPage = {
    pattern: [':model', ':id', 'graph'],
    render: async (ctx) => {
      const g = await walk(ctx, { depth, models: opts.models });
      return renderGraphPage(ctx, layout(g));
    }
  };
  if (opts.models) page.models = opts.models;

  const action: AdminPluginRecordAction = {
    label: 'Graph',
    href: ({ model, id, basePath }) => `${basePath}/${model.toLowerCase()}/${id}/graph`
  };
  if (opts.models) action.models = opts.models;

  return { name: 'relation-graph', pages: [page], recordActions: [action] };
}
