import { describe, it, expect } from 'vitest';
import { fieldInput, createView, editView } from '../../../src/lib/server/views/form.js';
import { parsePrismaSchema } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const Post = schema.models.find((m) => m.name === 'Post')!;
const Category = schema.models.find((m) => m.name === 'Category')!;
const f = (name: string) => User.fields.find((x) => x.name === name)!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };

describe('fieldInput', () => {
  it('rend une case cochée', () => {
    expect(fieldInput(f('isActive'), true, false)).toContain('checked');
  });

  it('rend une case décochée', () => {
    expect(fieldInput(f('isActive'), false, false)).not.toContain('checked');
  });

  it('désactive la case en lecture seule', () => {
    expect(fieldInput(f('isActive'), true, true)).toContain('disabled');
  });

  it.each(['visits', 'rating', 'balance'])('rend un input number pour %s', (name) => {
    expect(fieldInput(f(name), null, false)).toContain('type="number"');
  });

  it('rend un input number pour un champ Int', () => {
    // couvre spécifiquement le "case 'Int':" du switch, non exercé par
    // visits/rating/balance (BigInt/Float/Decimal).
    expect(fieldInput(f('id'), 1, false)).toContain('type="number"');
  });

  it('rend un datetime-local formaté', () => {
    const html = fieldInput(f('createdAt'), new Date('2026-01-15T10:30:00Z'), false);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-01-15T10:30"');
  });

  it('rend un datetime-local vide sans valeur', () => {
    expect(fieldInput(f('createdAt'), null, false)).toContain('value=""');
  });

  it('rend un textarea Json indenté et échappé', () => {
    const html = fieldInput(f('metadata'), { a: '<b>' }, false);
    expect(html).toContain('<textarea');
    expect(html).toContain('&lt;b&gt;');
  });

  it('rend un textarea Json vide sans valeur', () => {
    expect(fieldInput(f('metadata'), null, false)).toContain('></textarea>');
  });

  // L'heuristique est désormais insensible à la casse et inclut 'bio', ce qui
  // aligne fieldInput sur getInputType() du parser.
  it('rend un textarea pour un champ bio', () => {
    expect(fieldInput(f('bio'), 'texte', false)).toContain('<textarea');
  });

  it.each(['Description', 'CONTENT', 'postBody', 'Bio'])(
    'rend un textarea quelle que soit la casse du nom (%s)', (name) => {
      const field = { name, type: 'String', isRequired: false, hasDefault: false } as any;
      expect(fieldInput(field, 'x', false)).toContain('<textarea');
    }
  );

  it('rend un textarea pour un champ content', () => {
    const contentField = Post.fields.find((x) => x.name === 'content')!;
    expect(fieldInput(contentField, 'texte', false)).toContain('<textarea');
  });

  it('rend un textarea pour un champ description', () => {
    const descriptionField = Category.fields.find((x) => x.name === 'description')!;
    expect(fieldInput(descriptionField, 'texte', false)).toContain('<textarea');
  });

  it('rend un textarea pour un champ dont le nom contient body', () => {
    const bodyField = { name: 'body', type: 'String', isRequired: false, hasDefault: false } as any;
    expect(fieldInput(bodyField, 'texte', false)).toContain('<textarea');
  });

  it('marque requis un textarea Json obligatoire sans défaut', () => {
    const requiredJson = { name: 'metadata', type: 'Json', isRequired: true, hasDefault: false } as any;
    const html = fieldInput(requiredJson, null, false);
    expect(html).toContain(' *</label>');
    expect(html).toContain('required');
  });

  it('marque requis un textarea de contenu obligatoire sans défaut', () => {
    const requiredContent = { name: 'content', type: 'String', isRequired: true, hasDefault: false } as any;
    const html = fieldInput(requiredContent, 'texte', false);
    expect(html).toContain(' *</label>');
    expect(html).toContain('required');
  });

  it('désactive un textarea Json en lecture seule', () => {
    expect(fieldInput(f('metadata'), null, true)).toContain('<textarea name="metadata" class="ska-input" rows="4" readonly');
  });

  it('désactive un textarea de contenu en lecture seule', () => {
    const contentField = Post.fields.find((x) => x.name === 'content')!;
    expect(fieldInput(contentField, 'texte', true)).toContain('<textarea name="content" class="ska-input" rows="4" readonly');
  });

  it('rend un input text pour un String ordinaire', () => {
    expect(fieldInput(f('email'), 'a@b.c', false)).toContain('type="text"');
  });

  it('marque requis un champ obligatoire sans défaut', () => {
    expect(fieldInput(f('email'), null, false)).toContain('required');
  });

  it('ne marque pas requis un champ à valeur par défaut', () => {
    expect(fieldInput(f('isActive'), null, false)).not.toContain('required');
  });

  it('ne marque pas requis un champ optionnel', () => {
    // name est String? : isRequired est déjà faux, donc required doit rester
    // faux indépendamment de hasDefault/isReadonly.
    expect(fieldInput(f('name'), null, false)).not.toContain('required');
  });

  it('ne marque pas requis un champ en lecture seule', () => {
    const html = fieldInput(f('email'), null, true);
    expect(html).toContain('readonly');
    expect(html).not.toContain('required');
  });
});

describe('createView', () => {
  const config = { prisma: {}, models: { User: { hidden: ['password'] } } } as any;

  it('exclut les champs cachés, auto-générés, relations et à défaut', () => {
    const html = createView(viewModel, '/admin', config);
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="id"');
    expect(html).not.toContain('name="createdAt"');
    expect(html).not.toContain('name="updatedAt"');
    expect(html).not.toContain('name="posts"');
    expect(html).not.toContain('name="isActive"');
    expect(html).toContain('name="email"');
  });

  it('porte l’action create', () => {
    expect(createView(viewModel, '/admin', config)).toContain('value="create"');
  });

  it('affiche une alerte quand une erreur est fournie', () => {
    expect(createView(viewModel, '/admin', config, 'boom')).toContain('ska-alert--error');
  });

  it('n’affiche pas d’alerte sans erreur', () => {
    expect(createView(viewModel, '/admin', config)).not.toContain('ska-alert--error');
  });

  it('fonctionne sans config.models déclaré', () => {
    // Couvre les valeurs par défaut `config.models?.[model.name] || {}` et
    // `modelConfig.hidden || []` quand aucun modèle n'est configuré.
    const html = createView(viewModel, '/admin', { prisma: {} } as any);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
  });
});

describe('editView', () => {
  const item = { id: 1, email: 'a@b.c', createdAt: new Date('2026-01-01T00:00:00Z') };

  it('porte l’action update et l’id échappé', () => {
    const html = editView(viewModel, { ...item, id: '<b>' }, '/admin', { prisma: {} } as any);
    expect(html).toContain('value="update"');
    expect(html).toContain('ID: &lt;b&gt;');
  });

  it('rend en lecture seule les champs auto-générés (createdAt)', () => {
    const html = editView(viewModel, item, '/admin', { prisma: {} } as any);
    expect(html).toMatch(/name="createdAt"[^>]*readonly/);
  });

  it('rend en lecture seule les champs auto-générés (updatedAt)', () => {
    const html = editView(viewModel, item, '/admin', { prisma: {} } as any);
    expect(html).toMatch(/name="updatedAt"[^>]*readonly/);
  });

  it('rend en lecture seule les champs déclarés readonly', () => {
    const config = { prisma: {}, models: { User: { readonly: ['email'] } } } as any;
    expect(editView(viewModel, item, '/admin', config)).toMatch(/name="email"[^>]*readonly/);
  });

  it('ne rend pas en lecture seule un champ ordinaire non déclaré', () => {
    expect(editView(viewModel, item, '/admin', { prisma: {} } as any))
      .not.toMatch(/name="email"[^>]*readonly/);
  });

  it('masque les champs cachés', () => {
    const config = { prisma: {}, models: { User: { hidden: ['password'] } } } as any;
    expect(editView(viewModel, item, '/admin', config)).not.toContain('name="password"');
  });

  it('affiche une alerte quand une erreur est fournie', () => {
    expect(editView(viewModel, item, '/admin', { prisma: {} } as any, 'boom')).toContain('ska-alert--error');
  });
});
