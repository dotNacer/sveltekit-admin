/**
 * Vérification d'origine des requêtes mutantes servies sous `basePath`.
 *
 * SvelteKit fait le même contrôle (`runtime/server/respond.js`) mais ne peut
 * pas porter la garantie ici : il tourne avant le hook `handle` (invisible
 * pour cette lib), un `kit.csrf.checkOrigin: false` posé pour une route sans
 * rapport le désactive partout, et il est court-circuité en dev. Revérifié
 * ici, dev compris : un proxy qui strippe `Origin` doit casser sur
 * `pnpm run dev`, pas en production.
 */

/** Sans effet de bord : jamais un vecteur CSRF, jamais inspectées. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfConfig =
  | false
  | {
      /**
       * Origines acceptées en plus de celle de la requête. Normalisées en
       * origine, donc `https://ops.example/` et `https://ops.example` sont
       * la même entrée.
       */
      trustedOrigins?: string[];
    };

export interface ResolvedCsrf {
  enabled: boolean;
  trustedOrigins: Set<string>;
}

/** Résolue au boot : une entrée illisible doit faire échouer `createAdminHandler`. */
export function resolveCsrfConfig(csrf: CsrfConfig | undefined): ResolvedCsrf {
  if (csrf === false) return { enabled: false, trustedOrigins: new Set() };

  const trustedOrigins = new Set<string>();
  for (const entry of csrf?.trustedOrigins ?? []) {
    let origin: string;
    try {
      origin = new URL(entry).origin;
    } catch {
      throw new Error(
        `[sveltekit-admin] csrf.trustedOrigins contains "${entry}", which is not an absolute ` +
          'URL. Use a full origin such as "https://admin.example.com".'
      );
    }
    // `javascript:`, `data:`, `file:`… normalisent en "null", ce qu'envoie
    // aussi une iframe sandboxée : les accepter ouvrirait à tout contexte opaque.
    if (origin === 'null') {
      throw new Error(
        `[sveltekit-admin] csrf.trustedOrigins contains "${entry}", whose origin is opaque ` +
          '("null"). Only http(s) origins can be trusted.'
      );
    }
    trustedOrigins.add(origin);
  }
  return { enabled: true, trustedOrigins };
}

export function verifyOrigin(
  csrf: ResolvedCsrf,
  event: {
    url: URL;
    request: { method: string; headers: { get(name: string): string | null } };
  }
): Response | null {
  if (!csrf.enabled) return null;
  if (SAFE_METHODS.has(event.request.method)) return null;

  const origin = event.request.headers.get('origin');
  if (origin === event.url.origin) return null;
  // `trustedOrigins` ne contient jamais `null` (rejeté au boot) : un en-tête
  // absent ne peut donc pas y correspondre.
  if (origin !== null && csrf.trustedOrigins.has(origin)) return null;

  // Corps statique : ne jamais réfléchir l'`Origin` reçu ni énumérer les
  // origines acceptées.
  return new Response('[sveltekit-admin] Cross-site request forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
