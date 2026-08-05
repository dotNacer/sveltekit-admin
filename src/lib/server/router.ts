export interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit';
  model?: string;
  id?: string;
}

export function parseRoute(pathname: string, basePath: string): ParsedRoute {
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

  return { view: 'dashboard' };
}
