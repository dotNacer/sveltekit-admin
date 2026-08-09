import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, SEARCH_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

/**
 * `ListQuery.ignored` doit être rendu dans l'UI (docs/design §5.4), pour
 * deux raisons documentées : (1) sans ça, l'utilisateur ne comprend pas
 * pourquoi son URL bricolée ne fait rien, (2) ça rend la branche `ignored`
 * observable et testable via le rendu réel. Un champ sensible doit produire
 * EXACTEMENT le même message qu'un champ inconnu — jamais "champ interdit",
 * ce qui confirmerait son existence (§0.a).
 */

const articles = [{ id: 1, title: 'A', published: true, status: 'PUBLISHED', views: 10, price: 1, createdAt: new Date() }];

function handler(prisma: any, config: Record<string, unknown> = {}) {
  return createAdminHandler({ prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH, ...config } as any);
}

describe('ignored filters are rendered in the UI (§5.4)', () => {
  it('an unknown field produces a visible "field unknown" message', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.doesNotExist=x' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Ignored filter: field "doesNotExist" unknown');
  });

  it('a sensitive field produces the EXACT SAME message as an unknown field — never "forbidden"', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.apiToken=x' });
    const html = await (await h({ event, resolve } as any)).text();
    // Same wording as the unknown-field case above — never something that
    // would confirm the field exists, like "forbidden" or "not allowed".
    expect(html).toContain('Ignored filter: field "apiToken" unknown');
  });

  it('an operator suffix (__gte) is stripped from the displayed field name', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.doesNotExist__gte=1' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Ignored filter: field "doesNotExist" unknown');
  });

  it('a bad-value case (unparseable filter) is also rendered', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.views=not-a-number' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Ignored filter: field "views" unknown');
  });

  it('no ignored filters: no alert block is rendered at all', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.published=true' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toContain('Ignored filter');
  });

  it('two distinct ignored params both produce a message, each rendered once', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?f.nope1=x&f.nope2=y' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('Ignored filter: field "nope1" unknown');
    expect(html).toContain('Ignored filter: field "nope2" unknown');
  });

  it('legacy ?filter= with an unusable value produces a generic message, not a crash', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = handler(prisma);
    const { event, resolve } = createEvent({ url: '/admin/article?filter=noColonHere' });
    const res = await h({ event, resolve } as any);
    expect(res.status).toBe(200);
  });
});

describe('listFilterDefaults.autoDetect: false (bug found in review — the flag was declared but never read)', () => {
  it('suppresses the auto-detected sidebar entirely when no explicit listFilter is set', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = createAdminHandler({
      prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH,
      listFilterDefaults: { autoDetect: false }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).not.toMatch(/class="ska-filters__group"/);
  });

  it('does NOT suppress an EXPLICIT listFilter config even when autoDetect is disabled', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = createAdminHandler({
      prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH,
      listFilterDefaults: { autoDetect: false },
      models: { Article: { listFilter: ['published'] } }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('href="/admin/article?f.published=true"');
  });

  it('default (no config at all): auto-detection stays on, exactly as before this fix', async () => {
    const prisma = createPrismaMock({ article: articles });
    const h = createAdminHandler({ prisma, prismaSchemaPath: SEARCH_SCHEMA_PATH } as any);
    const { event, resolve } = createEvent({ url: '/admin/article' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('ska-filters__group');
  });
});
