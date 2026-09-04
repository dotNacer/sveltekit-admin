import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resolve } from 'node:path';
import { PrismaClient } from '../fixtures/prisma/client/index.js';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
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
    // Svelte encadre chaque texte dynamique de commentaires de marquage
    // (`<!--id-->valeur<!---->`), d'où la recherche sur ce motif plutôt que
    // sur `<td>b</td>` littéral.
    expect(html.indexOf('>b<!----></td>')).toBeLessThan(html.indexOf('>a<!----></td>'));
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
    // Le handler ne journalise via console.error que les codes pilote NON
    // reconnus (cf. handler.ts) : on tait quand même la sortie au cas où,
    // mais P2002 est classifié — pas de bruit attendu ici.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.widget.create({ data: { name: 'dup' } });
    const res = await call('/admin/widget/new', {
      _action: 'create',
      name: 'dup',
      // `price` et non `quantity` : un champ à `@default(...)` n'est pas rendu
      // par le formulaire de création, il ne prouverait donc rien ici.
      price: '9.99'
    });
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).toContain(ERROR_ALERT);
    // Le code P2002 renvoyé par le vrai moteur SQLite est classifié en
    // `conflict` : le message générique de la bibliothèque est rendu, jamais
    // le texte brut du pilote.
    expect(html).toContain('A record with these values already exists.');
    // Et le formulaire re-rendu porte ce qui venait d'être soumis, sur une
    // erreur levée par le vrai pilote et non par un code mocké.
    expect(html).toContain('value="dup"');
    expect(html).toContain('value="9.99"');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("rend une alerte sur suppression d'un id inexistant", async () => {
    // Idem : P2025 est classifié en `notFound`, donc pas journalisé.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (await call('/admin/widget/9999', { _action: 'delete' })).text();
    expect(html).toContain(ERROR_ALERT);
    // Le code P2025 renvoyé par le vrai moteur SQLite est classifié en
    // `notFound` : le message générique de la bibliothèque est rendu, jamais
    // le texte brut du pilote.
    expect(html).toContain('This record no longer exists.');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('rend un dashboard configuré de bout en bout, avec un vrai tri « recent »', async () => {
    // Le fixture Prisma n'a ni modèle `User` ni champ `password` : on
    // s'appuie sur les modèles réellement présents ici (`Widget`, `Doc`).
    const dashboardHandler = createAdminHandler({
      prisma,
      prismaSchemaPath: SCHEMA,
      dashboard: {
        title: 'Console',
        widgets: [
          { type: 'count', model: 'Widget', label: 'Active widgets', query: 'f.active=true' },
          { type: 'models', title: 'Content', models: ['Doc'] },
          { type: 'recent', model: 'Widget', limit: 2 }
        ]
      }
    });
    // Id explicite, HORS de l'ordre d'insertion : la ligne d'id 3 est créée
    // EN PREMIER, celle d'id 10 en second. `createPrismaMock.findMany`
    // (utilisé par les tests unitaires) ignore `orderBy` et ne peut donc
    // jamais distinguer un vrai tri d'un simple ordre d'insertion — c'est
    // exactement ce qu'un mock ne peut pas prouver. Ici, si `loadDashboard`
    // renvoyait les lignes dans l'ordre d'insertion plutôt que par un
    // véritable `ORDER BY id DESC` exécuté par SQLite, « Three » (id 3)
    // sortirait avant « Ten » (id 10). Seul le vrai moteur peut mettre
    // « Ten » en tête.
    await prisma.widget.create({ data: { id: 3, name: 'Three', active: true } });
    await prisma.widget.create({ data: { id: 10, name: 'Ten', active: false } });

    const { event, resolve: res } = createEvent({ url: '/admin' });
    const html = await (await dashboardHandler({ event, resolve: res })).text();

    expect(html).toContain('Console');
    expect(html).toContain('Active widgets');
    expect(html).toContain('href="/admin/widget?f.active=true"');
    expect(html).toContain('Content');
    expect(html).toContain('Latest Widget');
    const tenIndex = html.indexOf('href="/admin/widget/10"');
    const threeIndex = html.indexOf('href="/admin/widget/3"');
    expect(tenIndex).toBeGreaterThan(-1);
    expect(threeIndex).toBeGreaterThan(-1);
    expect(tenIndex).toBeLessThan(threeIndex);
  });
});

describe('audit callback sur une vraie base SQLite', () => {
  it('create expose l’id généré', async () => {
    const audit = vi.fn();
    const h = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA, audit });
    const { event, resolve } = createEvent({
      url: '/admin/widget/new',
      body: { _action: 'create', name: 'audited', quantity: '3' }
    });
    const res = await h({ event, resolve });
    expect(res.status).toBe(303);
    const row = await prisma.widget.findUnique({ where: { name: 'audited' } });
    expect(row).not.toBeNull();
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('create');
    expect(entry.model).toBe('Widget');
    expect(entry.id).toBe(row!.id);
    expect(entry.values.name).toBe('audited');
    expect(entry.after.name).toBe('audited');
  });

  it('update calcule changes.name', async () => {
    const w = await prisma.widget.create({ data: { name: 'before-audit' } });
    const audit = vi.fn();
    const h = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA, audit });
    const { event, resolve } = createEvent({
      url: `/admin/widget/${w.id}`,
      body: { _action: 'update', name: 'after-audit', quantity: '0' }
    });
    expect((await h({ event, resolve })).status).toBe(303);
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('update');
    expect(entry.id).toBe(w.id);
    expect(entry.changes.name).toEqual({ from: 'before-audit', to: 'after-audit' });
  });

  it('delete porte before et retire la ligne', async () => {
    const w = await prisma.widget.create({ data: { name: 'doomed-audit' } });
    const audit = vi.fn();
    const h = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA, audit });
    const { event, resolve } = createEvent({
      url: `/admin/widget/${w.id}`,
      body: { _action: 'delete' }
    });
    expect((await h({ event, resolve })).status).toBe(303);
    expect(await prisma.widget.findUnique({ where: { id: w.id } })).toBeNull();
    const entry = audit.mock.calls[0][0];
    expect(entry.action).toBe('delete');
    expect(entry.before.name).toBe('doomed-audit');
  });

  it('contrainte unique : pas d’audit', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await prisma.widget.create({ data: { name: 'dup-audit' } });
    const audit = vi.fn();
    const h = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA, audit });
    const { event, resolve } = createEvent({
      url: '/admin/widget/new',
      body: { _action: 'create', name: 'dup-audit' }
    });
    const html = await (await h({ event, resolve })).text();
    expect(html).toContain(ERROR_ALERT);
    expect(audit).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
