import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import FieldInput from '../../../src/lib/server/views/FieldInput.svelte';
import Form from '../../../src/lib/server/views/Form.svelte';
import { parsePrismaSchema } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const Post = schema.models.find((m) => m.name === 'Post')!;
const Category = schema.models.find((m) => m.name === 'Category')!;
const f = (name: string) => User.fields.find((x) => x.name === name)!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };

const renderField = (field: any, value: any, isReadonly: boolean) =>
  render(FieldInput, { props: { field, value, isReadonly } }).body;

describe('FieldInput.svelte', () => {
  it('rend une case cochée', () => {
    expect(renderField(f('isActive'), true, false)).toContain('checked');
  });

  it('rend une case décochée', () => {
    expect(renderField(f('isActive'), false, false)).not.toContain('checked');
  });

  it('désactive la case en lecture seule', () => {
    expect(renderField(f('isActive'), true, true)).toContain('disabled');
  });

  it.each(['visits', 'rating', 'balance'])('rend un input number pour %s', (name) => {
    expect(renderField(f(name), null, false)).toContain('type="number"');
  });

  it('rend un input number pour un champ Int', () => {
    expect(renderField(f('id'), 1, false)).toContain('type="number"');
  });

  it('rend un datetime-local formaté', () => {
    const html = renderField(f('createdAt'), new Date('2026-01-15T10:30:00Z'), false);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-01-15T10:30"');
  });

  it('rend un datetime-local vide sans valeur', () => {
    expect(renderField(f('createdAt'), null, false)).toContain('value=""');
  });

  it('rend un textarea Json indenté et échappé', () => {
    const html = renderField(f('metadata'), { a: '<b>' }, false);
    expect(html).toContain('<textarea');
    expect(html).toContain('&lt;b>');
  });

  it('rend un textarea Json vide sans valeur', () => {
    expect(renderField(f('metadata'), null, false)).toContain('></textarea>');
  });

  it('rend un textarea pour un champ bio', () => {
    expect(renderField(f('bio'), 'texte', false)).toContain('<textarea');
  });

  it.each(['Description', 'CONTENT', 'postBody', 'Bio'])(
    'rend un textarea quelle que soit la casse du nom (%s)', (name) => {
      const field = { name, type: 'String', isRequired: false, hasDefault: false } as any;
      expect(renderField(field, 'x', false)).toContain('<textarea');
    }
  );

  it('rend un textarea pour un champ content', () => {
    const contentField = Post.fields.find((x) => x.name === 'content')!;
    expect(renderField(contentField, 'texte', false)).toContain('<textarea');
  });

  it('rend un textarea pour un champ description', () => {
    const descriptionField = Category.fields.find((x) => x.name === 'description')!;
    expect(renderField(descriptionField, 'texte', false)).toContain('<textarea');
  });

  it('rend un textarea pour un champ dont le nom contient body', () => {
    const bodyField = { name: 'body', type: 'String', isRequired: false, hasDefault: false } as any;
    expect(renderField(bodyField, 'texte', false)).toContain('<textarea');
  });

  it('marque requis un textarea Json obligatoire sans défaut', () => {
    const requiredJson = { name: 'metadata', type: 'Json', isRequired: true, hasDefault: false } as any;
    const html = renderField(requiredJson, null, false);
    expect(html).toContain(' *</label>');
    expect(html).toContain('required');
  });

  it('marque requis un textarea de contenu obligatoire sans défaut', () => {
    const requiredContent = { name: 'content', type: 'String', isRequired: true, hasDefault: false } as any;
    const html = renderField(requiredContent, 'texte', false);
    expect(html).toContain(' *</label>');
    expect(html).toContain('required');
  });

  it('désactive un textarea Json en lecture seule', () => {
    expect(renderField(f('metadata'), null, true)).toMatch(/<textarea[^>]*name="metadata"[^>]*readonly/);
  });

  it('désactive un textarea de contenu en lecture seule', () => {
    const contentField = Post.fields.find((x) => x.name === 'content')!;
    expect(renderField(contentField, 'texte', true)).toMatch(/<textarea[^>]*name="content"[^>]*readonly/);
  });

  it('rend un input text pour un String ordinaire', () => {
    expect(renderField(f('email'), 'a@b.c', false)).toContain('type="text"');
  });

  it('marque requis un champ obligatoire sans défaut', () => {
    expect(renderField(f('email'), null, false)).toContain('required');
  });

  it('ne marque pas requis un champ à valeur par défaut', () => {
    expect(renderField(f('isActive'), null, false)).not.toContain('required');
  });

  it('ne marque pas requis un champ optionnel', () => {
    expect(renderField(f('name'), null, false)).not.toContain('required');
  });

  it('ne marque pas requis un champ en lecture seule', () => {
    const html = renderField(f('email'), null, true);
    expect(html).toContain('readonly');
    expect(html).not.toContain('required');
  });
});

const renderForm = (mode: 'create' | 'edit', model: any, basePath: string, config: any, item?: any) =>
  render(Form, { props: { mode, model, basePath, config, item } }).body;

describe('Form.svelte (create)', () => {
  const config = { prisma: {}, models: { User: { hidden: ['password'] } } } as any;

  it('exclut les champs cachés, auto-générés, relations et à défaut', () => {
    const html = renderForm('create', viewModel, '/admin', config);
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="id"');
    expect(html).not.toContain('name="createdAt"');
    expect(html).not.toContain('name="updatedAt"');
    expect(html).not.toContain('name="posts"');
    expect(html).not.toContain('name="isActive"');
    expect(html).toContain('name="email"');
  });

  it('échappe le libellé fourni par la configuration', () => {
    const html = renderForm('create', { ...viewModel, label: '<b>U' }, '/admin', config);
    expect(html).toContain('Create');
    expect(html).toContain('&lt;b>U');
    expect(html).not.toContain('<b>U');
  });

  it('porte l’action create', () => {
    expect(renderForm('create', viewModel, '/admin', config)).toContain('value="create"');
  });

  it('fonctionne sans config.models déclaré', () => {
    const html = renderForm('create', viewModel, '/admin', { prisma: {} } as any);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
  });
});

describe('Form.svelte (edit)', () => {
  const item = { id: 1, email: 'a@b.c', createdAt: new Date('2026-01-01T00:00:00Z') };

  it('porte l’action update et échappe la PK dans le titre', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, { ...item, id: '<b>' });
    expect(html).toContain('value="update"');
    expect(html).toContain('ID: &lt;b>');
    expect(html).not.toContain('<b>');
  });

  it('échappe le libellé fourni par la configuration', () => {
    const html = renderForm('edit', { ...viewModel, label: '<b>U' }, '/admin', { prisma: {} } as any, item);
    expect(html).toContain('Edit');
    expect(html).toContain('&lt;b>U');
    expect(html).not.toContain('<b>U');
  });

  it('rend en lecture seule les champs auto-générés (createdAt)', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).toMatch(/name="createdAt"[^>]*readonly/);
  });

  it('rend en lecture seule les champs auto-générés (updatedAt)', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).toMatch(/name="updatedAt"[^>]*readonly/);
  });

  it('rend en lecture seule les champs déclarés readonly', () => {
    const config = { prisma: {}, models: { User: { readonly: ['email'] } } } as any;
    expect(renderForm('edit', viewModel, '/admin', config, item)).toMatch(/name="email"[^>]*readonly/);
  });

  it('ne rend pas en lecture seule un champ ordinaire non déclaré', () => {
    expect(renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item))
      .not.toMatch(/name="email"[^>]*readonly/);
  });

  it('masque les champs cachés', () => {
    const config = { prisma: {}, models: { User: { hidden: ['password'] } } } as any;
    expect(renderForm('edit', viewModel, '/admin', config, item)).not.toContain('name="password"');
  });
});
