export interface ResolveSpy {
  (event: unknown): Promise<Response>;
  called: boolean;
}

export interface FakeEvent {
  url: URL;
  request: Request;
  locals: Record<string, unknown>;
}

/**
 * Construit un faux RequestEvent SvelteKit et un espion `resolve`.
 * `body` déclenche une requête POST en application/x-www-form-urlencoded.
 */
export function createEvent(opts: {
  url: string;
  method?: string;
  body?: Record<string, string>;
  locals?: Record<string, unknown>;
}): { event: FakeEvent; resolve: ResolveSpy } {
  const url = new URL(opts.url, 'http://localhost');
  const method = opts.method ?? (opts.body ? 'POST' : 'GET');

  const init: RequestInit = { method };
  if (opts.body) {
    init.body = new URLSearchParams(opts.body);
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  const resolve = (async () => {
    resolve.called = true;
    return new Response('resolved-by-sveltekit');
  }) as ResolveSpy;
  resolve.called = false;

  return {
    event: { url, request: new Request(url, init), locals: opts.locals ?? {} },
    resolve
  };
}
