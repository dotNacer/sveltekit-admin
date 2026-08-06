export interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit' | 'notFound';
  model?: string;
  id?: string;
}

export function parseRoute(pathname: string, basePath: string): ParsedRoute {
  // Le `replace` n'est PAS redondant avec le `filter(Boolean)` plus bas : il est ce
  // qui fait que `/admin/` et `/admin///` donnent un `path` vide, donc le dashboard.
  // Sans lui, `path` vaudrait '/' — truthy — et le chemin tomberait sur `notFound`.
  const path = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, '');

  if (!path) {
    return { view: 'dashboard' };
  }

  const segments = path.split('/').filter(Boolean);

  if (segments.length === 1) {
    return { view: 'list', model: segments[0] };
  }

  if (segments.length === 2) {
    if (segments[1] === 'new') {
      return { view: 'create', model: segments[0] };
    }
    return { view: 'edit', model: segments[0], id: segments[1] };
  }

  // 3 segments ou plus : aucune vue ne correspond.
  return { view: 'notFound' };
}
