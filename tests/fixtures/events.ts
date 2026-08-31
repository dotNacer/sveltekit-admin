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
 * Une valeur tableau produit la clé répétée qu'un groupe de checkboxes envoie
 * (`__rel__tags=1&__rel__tags=2`) — `URLSearchParams` joindrait sinon par une
 * virgule, ce qui n'est pas la même requête.
 *
 * `origin` reproduit l'en-tête `Origin` : par défaut celui de l'URL (un POST
 * same-origin de navigateur), `null` pour l'omettre, une autre origine pour
 * forger une requête cross-site.
 */
export function createEvent(opts: {
  url: string;
  method?: string;
  body?: Record<string, string | string[]>;
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
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.body)) {
      for (const one of Array.isArray(value) ? value : [value]) params.append(key, one);
    }
    init.body = params;
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
