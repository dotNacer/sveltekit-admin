import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

// Only 3 tests here. This file exercises escaping through the real black-box
// `createAdminHandler` entry point only, i.e. payloads that travel through an
// actual HTTP URL. Escaping of the not-found message and of the primary-key
// display in the edit form is real defence-in-depth — `NotFound.svelte` also
// renders model names sourced from the parsed schema and from user config,
// and `Form.svelte` renders database values — but neither is reachable
// through a URL path segment in this handler: WHATWG `URL` percent-encodes
// `<`, `>` and `"` in `pathname`, so a payload can never arrive at those two
// call sites raw here. That defence-in-depth is instead directly unit-tested
// at the component level in `tests/unit/views/notFound.test.ts` (see
// `'échappe le message'`) and `tests/unit/views/form.test.ts` (see
// `'porte l'action update et échappe la PK dans le titre'` and the
// label-escaping tests), where the payload is passed straight to the
// component and isn't filtered by `URL`'s percent-encoding first.
// Kept here are only the tests that exercise a genuinely reachable defect
// through the black-box handler.

function handler(prisma = createPrismaMock({ user: [], post: [], category: [] })) {
  return createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH });
}

describe('échappement HTML', () => {
  it('échappe une valeur Json qui tente de sortir du textarea', async () => {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: 'a@b.c', password: 'x', metadata: { evil: '</textarea><script>alert(1)</script>' } }]
    });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain('&lt;/textarea>');
  });

  it('échappe une valeur String longue rendue en textarea', async () => {
    const prisma = createPrismaMock({
      post: [{ id: 'ckpost1', title: 't', content: '</textarea><script>alert(1)</script>' }]
    });
    const { event, resolve } = createEvent({ url: '/admin/post/ckpost1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain('&lt;/textarea>');
  });

  // Ce test ne prouve pas un échappement : Svelte n'échappe jamais `'` car il
  // délimite toujours les attributs avec des guillemets doubles, donc un `'`
  // brut ne peut pas fermer l'attribut ni en sortir — sans danger ici, à la
  // différence de `"` que Svelte échappe bien.
  it('rend l’apostrophe sans casser l’attribut', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: "o'brien@b.c", password: 'x' }] });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('value="o\'brien@b.c"');
  });
});
