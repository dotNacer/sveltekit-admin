import { describe, it, expect } from 'vitest';
import { listView } from '../../../src/lib/server/views/list.js';
import { parsePrismaSchema } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };
const empty = { prisma: {} } as any;
const items = [{ id: 1, email: 'a@b.c', name: 'A' }, { id: 2, email: 'c@d.e', name: null }];

describe('listView', () => {
  it('affiche le nombre total', () => {
    expect(listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty))
      .toContain('2 records');
  });

  it('affiche un message quand la table est vide', () => {
    const html = listView(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty);
    expect(html).toContain('No records found');
  });

  it('limite l’affichage à 6 colonnes', () => {
    const html = listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect((html.match(/<th>/g) ?? []).length).toBe(7); // 6 colonnes + Actions
  });

  it('exclut les champs cachés', () => {
    const config = { prisma: {}, models: { User: { hidden: ['email'] } } } as any;
    expect(listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config))
      .not.toContain('<th>email</th>');
  });

  it('restreint aux listFields déclarés', () => {
    const config = { prisma: {}, models: { User: { listFields: ['email'] } } } as any;
    const html = listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect((html.match(/<th>/g) ?? []).length).toBe(2);
  });

  it('exclut les relations, Json et Bytes', () => {
    const config = {
      prisma: {}, models: { User: { listFields: ['metadata', 'avatar', 'posts', 'email'] } }
    } as any;
    const html = listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    // seul `email` survit : metadata est Json, avatar est Bytes, posts est une relation
    expect((html.match(/<th>/g) ?? []).length).toBe(2);
  });

  it('masque la pagination sur une seule page', () => {
    expect(listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty))
      .not.toContain('ska-pagination');
  });

  it('affiche Next sans Previous sur la première page', () => {
    const html = listView(viewModel, items, { page: 1, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=2');
    expect(html).not.toContain('?page=0');
    expect(html).toContain('Showing 1 to 2 of 10');
  });

  it('affiche Previous sans Next sur la dernière page', () => {
    const html = listView(viewModel, items, { page: 5, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=4');
    expect(html).not.toContain('?page=6');
    expect(html).toContain('Showing 9 to 10 of 10');
  });

  it('affiche les deux liens au milieu', () => {
    const html = listView(viewModel, items, { page: 3, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=2');
    expect(html).toContain('?page=4');
  });

  it('construit les liens d’édition et de suppression sur la PK', () => {
    const html = listView(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(html).toContain('href="/admin/user/1"');
    expect(html).toContain('value="delete"');
  });

  it('échappe la PK dans le lien de ligne et l’action de suppression', () => {
    // La PK vient de la base : un guillemet y ferme l'attribut et laisse injecter
    // du HTML dans le lien comme dans l'action du formulaire de suppression.
    const html = listView(
      viewModel,
      [{ id: 'a"b', email: 'x@y.z' }],
      { page: 1, perPage: 20, total: 1 },
      '/admin',
      empty
    );
    expect(html).not.toContain('"/admin/user/a"b"');
    expect(html).toContain('href="/admin/user/a&quot;b"');
    expect(html).toContain('action="/admin/user/a&quot;b"');
  });
});
