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
 *
 * `origin` reproduit l'en-tête `Origin` : par défaut celui de l'URL (un POST
 * same-origin de navigateur), `null` pour l'omettre, une autre origine pour
 * forger une requête cross-site.
 */
export function createEvent(opts: {
  url: string;
  method?: string;
  body?: Record<string, string>;
  locals?: Record<string, unknown>;
  origin?: string | null;
}): { event: FakeEvent; resolve: ResolveSpy } {
  const url = new URL(opts.url, 'http://localhost');
  const method = opts.method ?? (opts.body ? 'POST' : 'GET');

  const headers = new Headers();
  const origin = opts.origin === undefined ? url.origin : opts.origin;
  if (origin !== null) headers.set('Origin', origin);

  const init: RequestInit = { method, headers };
  if (opts.body) {
    init.body = new URLSearchParams(opts.body);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }

  const resolve: ResolveSpy = Object.assign(
    async () => {
      resolve.called = true;
      return new Response('resolved-by-sveltekit');
    },
    { called: false }
  );

  return {
    event: { url, request: new Request(url, init), locals: opts.locals ?? {} },
    resolve
  };
}
