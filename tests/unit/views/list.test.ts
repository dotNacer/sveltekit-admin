import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import List from '../../../src/lib/server/views/List.svelte';
import { parsePrismaSchema, parseSchemaContent } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };
const empty = { prisma: {} } as any;
const items = [{ id: 1, email: 'a@b.c', name: 'A' }, { id: 2, email: 'c@d.e', name: null }];

const renderList = (model: any, items: any[], pagination: any, basePath: string, config: any) =>
  render(List, { props: { model, items, pagination, basePath, config } }).body;

const columns = (html: string) =>
  [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);

describe('List.svelte', () => {
  it('affiche le nombre total', () => {
    expect(renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty))
      .toContain('2 records');
  });

  it('affiche un message quand la table est vide', () => {
    const html = renderList(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty);
    expect(html).toContain('No records found');
  });

  it('limite l’affichage à 6 colonnes et masque les champs sensibles', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(columns(html)).toEqual(['id', 'email', 'name', 'bio', 'role', 'is Active', 'Actions']);
    expect(columns(html)).not.toContain('password');
  });

  it('affiche un champ sensible nommé explicitement dans listFields', () => {
    const config = { prisma: {}, models: { User: { listFields: ['email', 'password'] } } } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'password', 'Actions']);
  });

  it('garde `hidden` prioritaire sur un listFields explicite', () => {
    const config = {
      prisma: {},
      models: { User: { hidden: ['password'], listFields: ['email', 'password'] } }
    } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'Actions']);
  });

  it('affiche un nom anodin attrapé par la sous-chaîne quand il est listé', () => {
    const local = parseSchemaContent(
      'model Note {\n  id Int @id\n  email String\n  hashtag String?\n}'
    ).models[0];
    const noteModel = { name: 'Note', label: 'Notes', fields: local.fields, primaryKey: 'id' };
    const config = { prisma: {}, models: { Note: { listFields: ['email', 'hashtag'] } } } as any;
    const html = renderList(noteModel, [{ id: 1 }], { page: 1, perPage: 20, total: 1 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'hashtag', 'Actions']);
  });

  it('masque un nom anodin attrapé par la sous-chaîne sans listFields', () => {
    const local = parseSchemaContent(
      'model Note {\n  id Int @id\n  email String\n  hashtag String?\n}'
    ).models[0];
    const noteModel = { name: 'Note', label: 'Notes', fields: local.fields, primaryKey: 'id' };
    const html = renderList(noteModel, [{ id: 1 }], { page: 1, perPage: 20, total: 1 }, '/admin', empty);
    expect(columns(html)).toEqual(['id', 'email', 'Actions']);
  });

  it('exclut les champs cachés', () => {
    const config = { prisma: {}, models: { User: { hidden: ['email'] } } } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).not.toContain('email');
  });

  it('restreint aux listFields déclarés', () => {
    const config = { prisma: {}, models: { User: { listFields: ['email'] } } } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'Actions']);
  });

  it('exclut les relations, Json et Bytes', () => {
    const config = {
      prisma: {}, models: { User: { listFields: ['metadata', 'avatar', 'posts', 'email'] } }
    } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'Actions']);
  });

  it('échappe le libellé fourni par la configuration', () => {
    const evil = { ...viewModel, label: '<b>U' };
    const html = renderList(evil, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(html).toContain('<h1>&lt;b>U</h1>');
    expect(html).toContain('Add &lt;b>U');
    expect(html).not.toContain('<b>U');
  });

  it('masque la pagination sur une seule page', () => {
    expect(renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty))
      .not.toContain('ska-pagination');
  });

  it('affiche Next sans Previous sur la première page', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=2');
    expect(html).not.toContain('?page=0');
    expect(html).toContain('Showing 1 to 2 of 10');
  });

  it('affiche Previous sans Next sur la dernière page', () => {
    const html = renderList(viewModel, items, { page: 5, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=4');
    expect(html).not.toContain('?page=6');
    expect(html).toContain('Showing 9 to 10 of 10');
  });

  it('affiche les deux liens au milieu', () => {
    const html = renderList(viewModel, items, { page: 3, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('?page=2');
    expect(html).toContain('?page=4');
  });

  it('construit les liens d’édition et de suppression sur la PK', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(html).toContain('href="/admin/user/1"');
    expect(html).toContain('value="delete"');
  });

  it('échappe la PK dans le lien de ligne et l’action de suppression', () => {
    const html = renderList(
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
