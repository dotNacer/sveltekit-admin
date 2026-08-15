export interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit' | 'notFound' | 'search' | 'logout';
  model?: string;
  id?: string;
}

export interface RouteEntry {
  pattern: string[];
  view: string;
}

export const BUILTIN_ROUTES: RouteEntry[] = [
  { pattern: [], view: 'dashboard' },
  { pattern: ['_search'], view: 'search' },
  { pattern: ['_logout'], view: 'logout' },
  { pattern: [':model', 'new'], view: 'create' },
  { pattern: [':model', ':id'], view: 'edit' },
  { pattern: [':model'], view: 'list' }
];

function relativeSegments(pathname: string, basePath: string): string[] {
  // Le `replace` n'est PAS redondant avec le `filter(Boolean)` plus bas : il est ce
  // qui fait que `/admin/` et `/admin///` donnent un `path` vide, donc le dashboard.
  // Sans lui, `path` vaudrait '/' — truthy — et le chemin tomberait sur `notFound`.
  const path = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, '');
  if (!path) return [];
  return path.split('/').filter(Boolean);
}

export function matchRoute(
  pathname: string,
  basePath: string,
  routes: RouteEntry[]
): { view: string; model?: string; id?: string } {
  const segments = relativeSegments(pathname, basePath);
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const captured: { model?: string; id?: string } = {};
    let ok = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const token = route.pattern[i]!;
      const seg = segments[i]!;
      if (token === ':model') {
        captured.model = seg;
      } else if (token === ':id') {
        captured.id = seg;
      } else if (token !== seg) {
        ok = false;
        break;
      }
    }
    if (ok) return { view: route.view, ...captured };
  }
  return { view: 'notFound' };
}

// Builtins-only helper — NOT the handler's dispatch path. `handler.ts` calls
// `matchRoute` directly with `[...pluginRoutes, ...BUILTIN_ROUTES]` so plugin
// patterns are considered first; this function stays around for tests and
// any caller that only cares about the builtin route table.
export function parseRoute(pathname: string, basePath: string): ParsedRoute {
  return matchRoute(pathname, basePath, BUILTIN_ROUTES) as ParsedRoute;
}
