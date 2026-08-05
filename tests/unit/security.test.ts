import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

const PAYLOAD = '<img src=x onerror=alert(1)>';

function handler(prisma = createPrismaMock({ user: [], post: [], category: [] })) {
  return createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH });
}

describe('échappement HTML', () => {
  it('échappe le nom de modèle inconnu venant de l’URL', async () => {
    const { event, resolve } = createEvent({ url: `/admin/${encodeURIComponent(PAYLOAD)}` });
    const html = await (await handler()({ event, resolve } as any)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('échappe l’id inconnu venant de l’URL', async () => {
    const { event, resolve } = createEvent({ url: `/admin/user/${encodeURIComponent(PAYLOAD)}` });
    const html = await (await handler()({ event, resolve } as any)).text();
    expect(html).not.toContain('<img src=x');
  });

  it('échappe une valeur Json qui tente de sortir du textarea', async () => {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: 'a@b.c', password: 'x', metadata: { evil: '</textarea><script>alert(1)</script>' } }]
    });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain('&lt;/textarea&gt;');
  });

  it('échappe une valeur String longue rendue en textarea', async () => {
    const prisma = createPrismaMock({
      user: [{ id: 1, email: 'a@b.c', password: 'x', bio: '</textarea><script>alert(1)</script>' }]
    });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('</textarea><script>');
  });

  it('échappe la valeur de PK affichée en vue édition', async () => {
    const prisma = createPrismaMock({ post: [{ id: PAYLOAD, title: 't' }] });
    const { event, resolve } = createEvent({ url: `/admin/post/${encodeURIComponent(PAYLOAD)}` });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).not.toContain('<img src=x');
  });

  it('échappe l’apostrophe', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: "o'brien@b.c", password: 'x' }] });
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler(prisma)({ event, resolve } as any)).text();
    expect(html).toContain('&#39;');
    expect(html).not.toContain('"o\'brien@b.c"');
  });
});
