import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resolve } from 'node:path';
import { PrismaClient } from '../fixtures/prisma/client/index.js';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createEvent } from '../fixtures/events.js';

const prisma = new PrismaClient();
const SCHEMA = resolve('tests/fixtures/prisma/schema.prisma');
const handler = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA });

/**
 * `.ska-alert--error` figure dans le CSS inline de *toutes* les pages : chercher
 * cette seule classe ne prouve rien. Ce fragment n'apparaît que dans le contenu
 * réellement rendu par le bloc catch du handler.
 */
const ERROR_ALERT = 'class="ska-alert ska-alert--error">Error:';

const call = (url: string, body?: Record<string, string>) => {
  const { event, resolve: res } = createEvent({ url, body });
  return handler({ event, resolve: res });
};

beforeEach(async () => {
  await prisma.widget.deleteMany();
  await prisma.doc.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('handler sur une vraie base SQLite', () => {
  it('affiche un dashboard avec les compteurs réels', async () => {
    await prisma.widget.create({ data: { name: 'w1' } });
    const html = await (await call('/admin')).text();
    expect(html).toContain('1 records');
  });

  it('crée un enregistrement depuis le formulaire', async () => {
    const res = await call('/admin/widget/new', {
      _action: 'create',
      name: 'created',
      quantity: '5',
      price: '9.99',
      active: 'on',
      metadata: '{"a":1}'
    });
    expect(res.status).toBe(303);
    const row = await prisma.widget.findUnique({ where: { name: 'created' } });
    expect(row).toMatchObject({ quantity: 5, price: 9.99, active: true, metadata: { a: 1 } });
  });

  it('met à jour un enregistrement à PK Int', async () => {
    const w = await prisma.widget.create({ data: { name: 'before' } });
    const res = await call(`/admin/widget/${w.id}`, {
      _action: 'update',
      name: 'after',
      quantity: '2'
    });
    expect(res.status).toBe(303);
    expect((await prisma.widget.findUnique({ where: { id: w.id } }))!.name).toBe('after');
  });

  it('supprime un enregistrement à PK Int', async () => {
    const w = await prisma.widget.create({ data: { name: 'doomed' } });
    await call(`/admin/widget/${w.id}`, { _action: 'delete' });
    expect(await prisma.widget.count()).toBe(0);
  });

  it("affiche le formulaire d'édition avec les valeurs en base", async () => {
    const w = await prisma.widget.create({ data: { name: 'shown', quantity: 3 } });
    const html = await (await call(`/admin/widget/${w.id}`)).text();
    expect(html).toContain('value="shown"');
    expect(html).toContain('value="3"');
  });

  it('pagine réellement', async () => {
    await prisma.widget.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({ name: `w${i}`, quantity: i }))
    });
    const page2 = await (await call('/admin/widget?page=2')).text();
    expect(page2).toContain('Showing 21 to 25 of 25');
  });

  it('produit un orderBy réellement valide et réellement appliqué', async () => {
    await prisma.widget.createMany({ data: [{ name: 'a' }, { name: 'b' }] });
    const html = await (await call('/admin/widget')).text();
    expect(html).not.toContain(ERROR_ALERT);
    // orderBy { id: 'desc' } : le dernier créé sort en premier.
    expect(html.indexOf('<td>b</td>')).toBeLessThan(html.indexOf('<td>a</td>'));
  });

  it('gère une PK String', async () => {
    const d = await prisma.doc.create({ data: { title: 'doc' } });
    const html = await (await call(`/admin/doc/${d.id}`)).text();
    expect(html).toContain('value="doc"');
  });

  it('édite un enregistrement à PK String dont la valeur est entièrement numérique', async () => {
    // Défaut n° 4 : avant correction, coerceId convertissait "12345" en nombre sans
    // consulter le type de la PK, et le vrai client Prisma rejetait la requête.
    const d = await prisma.doc.create({ data: { id: '12345', title: 'numeric id' } });
    const html = await (await call(`/admin/doc/${d.id}`)).text();
    expect(html).toContain('value="numeric id"');
    expect(html).not.toContain(ERROR_ALERT);
  });

  it('met à jour un enregistrement à PK String', async () => {
    const d = await prisma.doc.create({ data: { title: 'old' } });
    await call(`/admin/doc/${d.id}`, { _action: 'update', title: 'new' });
    expect((await prisma.doc.findUnique({ where: { id: d.id } }))!.title).toBe('new');
  });

  it('affiche not found sur un id inexistant', async () => {
    const html = await (await call('/admin/widget/9999')).text();
    expect(html).toContain('with ID');
  });

  it('rend une alerte sur violation de contrainte unique', async () => {
    // Le handler journalise l'erreur Prisma via console.error : on la tait pour
    // garder la sortie de la suite propre.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.widget.create({ data: { name: 'dup' } });
    const html = await (await call('/admin/widget/new', { _action: 'create', name: 'dup' })).text();
    expect(html).toContain(ERROR_ALERT);
    // Message émis par le moteur Prisma : la contrainte est bien appliquée par SQLite.
    expect(html).toContain('Unique constraint failed');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("rend une alerte sur suppression d'un id inexistant", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (await call('/admin/widget/9999', { _action: 'delete' })).text();
    expect(html).toContain(ERROR_ALERT);
    expect(html).toContain('records that were required but not found');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
