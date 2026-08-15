import type { RouteEntry } from './router.js';
import type { AdminPlugin, AdminPluginPage, AdminPluginRecordAction } from './plugin.js';

export interface PluginRegistry {
  routes: RouteEntry[];
  pagesByView: Map<string, AdminPluginPage>;
  recordActions: AdminPluginRecordAction[];
}

export function pluginViewId(pluginName: string, pattern: string[]): string {
  return `plugin/${pluginName}/${pattern.join('/')}`;
}

function patternKey(pattern: string[]): string {
  return pattern.join('\0');
}

function modelVisible(visibleModels: Array<{ name: string }>, entry: string): boolean {
  return visibleModels.some((m) => m.name.toLowerCase() === entry.toLowerCase());
}

function assertKnownModels(
  entries: string[] | undefined,
  visibleModels: Array<{ name: string }>,
  pluginName: string
): void {
  if (!entries) return;
  for (const entry of entries) {
    if (!modelVisible(visibleModels, entry)) {
      throw new Error(
        `[sveltekit-admin] plugin "${pluginName}" models[] includes unknown model "${entry}"`
      );
    }
  }
}

export function resolvePluginRegistry(
  plugins: AdminPlugin[],
  builtinRoutes: RouteEntry[],
  visibleModels: Array<{ name: string }>
): PluginRegistry {
  const builtinKeys = new Map(builtinRoutes.map((r) => [patternKey(r.pattern), r.view]));
  const taken = new Map<string, string>();
  const names = new Set<string>();
  const routes: RouteEntry[] = [];
  const pagesByView = new Map<string, AdminPluginPage>();
  const recordActions: AdminPluginRecordAction[] = [];

  for (const plugin of plugins) {
    if (!plugin.name) {
      throw new Error('[sveltekit-admin] plugin name must be a non-empty string');
    }
    if (names.has(plugin.name)) {
      throw new Error(`[sveltekit-admin] duplicate plugin name "${plugin.name}"`);
    }
    names.add(plugin.name);

    for (const page of plugin.pages ?? []) {
      for (const token of page.pattern) {
        if (token.startsWith(':') && token !== ':model' && token !== ':id') {
          throw new Error(
            `[sveltekit-admin] plugin "${plugin.name}" pattern token "${token}" is not :model or :id`
          );
        }
      }
      const hasModel = page.pattern.includes(':model');
      const hasId = page.pattern.includes(':id');
      if (page.models && !hasModel) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" page ${JSON.stringify(page.pattern)} sets models[] but pattern has no :model`
        );
      }
      if (hasId && !hasModel) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" page ${JSON.stringify(page.pattern)} has :id but pattern has no :model`
        );
      }
      assertKnownModels(page.models, visibleModels, plugin.name);

      const key = patternKey(page.pattern);
      const builtinView = builtinKeys.get(key);
      if (builtinView !== undefined) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" pattern ${JSON.stringify(page.pattern)} overlays builtin route "${builtinView}"`
        );
      }
      const other = taken.get(key);
      if (other !== undefined) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" pattern ${JSON.stringify(page.pattern)} collides with plugin "${other}"`
        );
      }
      taken.set(key, plugin.name);
      const view = pluginViewId(plugin.name, page.pattern);
      routes.push({ pattern: page.pattern, view });
      pagesByView.set(view, page);
    }

    for (const action of plugin.recordActions ?? []) {
      assertKnownModels(action.models, visibleModels, plugin.name);
      recordActions.push(action);
    }
  }

  return { routes, pagesByView, recordActions };
}

export function actionsForModel(
  registry: PluginRegistry,
  modelName: string
): AdminPluginRecordAction[] {
  return registry.recordActions.filter(
    (action) =>
      !action.models || action.models.some((n) => n.toLowerCase() === modelName.toLowerCase())
  );
}
