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
    // couvre spécifiquement le "case 'Int':" du switch, non exercé par
    // visits/rating/balance (BigInt/Float/Decimal).
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

  // L'heuristique de fieldInput est insensible à la casse et inclut 'bio' ;
  // depuis la suppression de getInputType, c'est la seule source de vérité.
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
    // name est String? : isRequired est déjà faux, donc required doit rester
    // faux indépendamment de hasDefault/isReadonly.
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
    expect(html).toContain('<h1>Create &lt;b>U</h1>');
    expect(html).not.toContain('<b>U');
  });

  it('porte l’action create', () => {
    expect(renderForm('create', viewModel, '/admin', config)).toContain('value="create"');
  });

  it('fonctionne sans config.models déclaré', () => {
    // Couvre les valeurs par défaut `config.models?.[model.name] || {}` et
    // `modelConfig.hidden || []` quand aucun modèle n'est configuré.
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
    expect(html).toContain('<h1>Edit &lt;b>U</h1>');
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

describe('Form.svelte — recordActions', () => {
  const item = { id: 1, email: 'a@b.c' };
  const actions = [{ label: '<img>', href: '/admin/user/1/graph' }];

  it('n’affiche aucune barre d’actions par défaut en edit', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).not.toContain('ska-record-actions');
    expect(html).not.toContain('/admin/user/1/graph');
  });

  it('en edit, rend les liens hors du form POST et échappe le label', () => {
    const html = render(Form, {
      props: {
        mode: 'edit',
        model: viewModel,
        basePath: '/admin',
        config: { prisma: {} } as any,
        item,
        recordActions: actions
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph"');
    expect(html).toContain('ska-record-actions');
    // escapeHtml (unlike Svelte's default text-escaping) also escapes `>` — this now
    // renders via {@html} + escapeHtml (see fix-round-1 notes), not Svelte text interpolation.
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
    const formStart = html.indexOf('<form method="POST"');
    const actionHref = html.indexOf('href="/admin/user/1/graph"');
    expect(actionHref).toBeGreaterThan(-1);
    expect(actionHref).toBeLessThan(formStart);
  });

  it('échappe un href malveillant contenant des guillemets/chevrons', () => {
    const html = render(Form, {
      props: {
        mode: 'edit',
        model: viewModel,
        basePath: '/admin',
        config: { prisma: {} } as any,
        item,
        recordActions: [
          { label: 'Graph', href: '/admin/user/1/graph" onclick="alert(1)' }
        ]
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph&quot; onclick=&quot;alert(1)"');
    expect(html).not.toContain('href="/admin/user/1/graph" onclick="alert(1)"');
  });

  it('en create, ignore recordActions même non vide', () => {
    const html = render(Form, {
      props: {
        mode: 'create',
        model: viewModel,
        basePath: '/admin',
        config: { prisma: {} } as any,
        recordActions: actions
      }
    }).body;
    expect(html).not.toContain('ska-record-actions');
    expect(html).not.toContain('/admin/user/1/graph');
  });
});

describe('Form.svelte — types non éditables', () => {
  const item = { id: 1, email: 'a@b.c', avatar: null };

  it("n'affiche pas une colonne Bytes à l'édition", () => {
    // Rendue en input texte, elle n'a jamais pu marcher : une chaîne envoyée
    // vers une colonne Bytes est refusée par le pilote.
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).not.toContain('name="avatar"');
  });

  it("n'affiche pas une colonne Bytes à la création", () => {
    const html = renderForm('create', viewModel, '/admin', { prisma: {} } as any);
    expect(html).not.toContain('name="avatar"');
  });

  it('continue d’afficher les autres colonnes', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).toContain('name="email"');
  });
});

describe('FieldInput.svelte — enum', () => {
  const renderEnum = (field: any, value: any, isReadonly = false, map: any = schema.enums) =>
    render(FieldInput, { props: { field, value, isReadonly, enums: map } }).body;

  /** `role` est `Role @default(USER)` : obligatoire (donc non nullable) ET à défaut. */
  const optionalEnum = { name: 'role', type: 'Role', isEnum: true, isRequired: false, hasDefault: false } as any;
  const requiredEnum = { name: 'role', type: 'Role', isEnum: true, isRequired: true, hasDefault: false } as any;

  it("rend un select avec une option par valeur de l'enum", () => {
    const html = renderEnum(f('role'), 'ADMIN');
    expect(html).toContain('name="role"');
    expect(html).toContain('<select');
    expect(html).toContain('<option value="USER"');
    expect(html).toContain('<option value="ADMIN"');
    expect(html).toContain('<option value="MODERATOR"');
  });

  it('sélectionne la valeur courante', () => {
    const html = renderEnum(f('role'), 'ADMIN');
    expect(html).toMatch(/<option value="ADMIN"[^>]*selected/);
    expect(html).not.toMatch(/<option value="USER"[^>]*selected/);
  });

  it('ajoute une option vide sur une colonne nullable', () => {
    expect(renderEnum(optionalEnum, null)).toContain('<option value="">— aucun —</option>');
  });

  it("n'ajoute pas d'option vide sur une colonne non nullable", () => {
    // `isRequired` (la colonne accepte-t-elle NULL) et non l'attribut `required`
    // du widget : `role` a un défaut, donc pas d'astérisque, mais la colonne
    // reste non nullable et « aucun » n'est pas une valeur qu'elle accepte.
    expect(renderEnum(f('role'), 'USER')).not.toContain('<option value="">— aucun —</option>');
  });

  it('place un placeholder désactivé sur une colonne non nullable sans valeur', () => {
    // Sans lui, le navigateur présélectionne la première valeur de l'enum et
    // la création écrit un choix que l'utilisateur n'a jamais fait.
    const html = renderEnum(f('role'), null);
    expect(html).toMatch(/<option value=""[^>]*disabled[^>]*selected/);
    expect(html).not.toMatch(/<option value="USER"[^>]*selected/);
  });

  it('marque requis un enum obligatoire sans défaut', () => {
    const html = renderEnum(requiredEnum, null);
    expect(html).toContain(' *</label>');
    expect(html).toMatch(/<select[^>]*required/);
  });

  it('donne la priorité à la valeur soumise sur la valeur en base', () => {
    const submitted = { values: { role: 'MODERATOR' }, m2m: {} };
    const html = render(FieldInput, {
      props: { field: f('role'), value: 'ADMIN', isReadonly: false, enums: schema.enums, submitted }
    }).body;
    expect(html).toMatch(/<option value="MODERATOR"[^>]*selected/);
    expect(html).not.toMatch(/<option value="ADMIN"[^>]*selected/);
  });

  it('désactive le select en lecture seule', () => {
    // Un `<select>` n'a pas de `readonly` : `disabled` le sort du POST, donc
    // `formDataToPrisma` ignore la clé et la colonne n'est pas réécrite.
    expect(renderEnum(f('role'), 'ADMIN', true)).toMatch(/<select[^>]*disabled/);
  });

  it("porte les attributs d'erreur du champ", () => {
    const html = render(FieldInput, {
      props: {
        field: f('role'), value: 'ADMIN', isReadonly: false,
        enums: schema.enums, errorMessage: 'Invalid role'
      }
    }).body;
    expect(html).toMatch(/<select[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<select[^>]*aria-describedby="role-error"/);
    expect(html).toContain('Invalid role');
  });

  it("retombe sur un input texte quand la map ne connaît pas le type", () => {
    expect(renderField(f('role'), 'ADMIN', false)).toContain('type="text"');
  });

  it('reçoit les valeurs portées par le ViewModel via Form', () => {
    const html = renderForm(
      'edit',
      { ...viewModel, enums: schema.enums },
      '/admin',
      { prisma: {} } as any,
      { id: 1, email: 'a@b.c', role: 'ADMIN' }
    );
    expect(html).toMatch(/<select[^>]*id="role"/);
    expect(html).toMatch(/<option value="ADMIN"[^>]*selected/);
  });

  it('retombe sur un input texte quand le ViewModel ne porte pas les enums', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, { id: 1, role: 'ADMIN' });
    expect(html).toMatch(/id="role"[^>]*type="text"/);
  });
});
