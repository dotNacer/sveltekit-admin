import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Layout from '../../../src/lib/server/views/Layout.svelte';
import List from '../../../src/lib/server/views/List.svelte';
import { styles } from '../../../src/lib/server/views/theme.js';
import { parsePrismaSchema } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';

/**
 * Base a11y : ce que le clavier voit, ce que le lecteur d'écran annonce, et ce
 * qui reste utilisable sous 900 px. Les règles CSS sont vérifiées sur la
 * feuille produite — c'est du texte, donc testable comme le reste.
 */

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };
const sheet = styles('#6366f1');

const layout = () =>
  render(Layout, {
    props: { content: 'X', config: { prisma: {} } as any, modelList: [{ name: 'User', label: 'Users' }] }
  }).body;

const list = (currentUrl?: URL) =>
  render(List, {
    props: {
      model: viewModel,
      items: [{ id: 1, email: 'a@b.c' }],
      pagination: { page: 1, perPage: 20, total: 1 },
      basePath: '/admin',
      config: { prisma: {} } as any,
      currentUrl
    }
  }).body;

describe('navigation au clavier', () => {
  it('offre un lien d’évitement vers le contenu', () => {
    // Sans lui, la nav latérale est retraversée à chaque page avant d'atteindre
    // quoi que ce soit d'utile.
    const html = layout();
    expect(html).toContain('href="#ska-content"');
    expect(html).toContain('id="ska-content"');
  });

  it('rend le lien d’évitement visible une fois ciblé', () => {
    expect(sheet).toMatch(/\.ska-skip:focus[^}]*\{/);
  });

  it('donne un indicateur de focus visible à tout élément interactif', () => {
    expect(sheet).toMatch(/:focus-visible/);
    for (const selector of ['.ska-btn', '.ska-nav__link', '.ska-checkbox']) {
      expect(sheet).toContain(`${selector}:focus-visible`);
    }
  });

  it('ne supprime plus l’indicateur de focus des champs sans le remplacer', () => {
    // `outline: none` suivi d'un box-shadow à 10 % d'opacité donnait un
    // contraste d'environ 1,1:1 — un indicateur invisible en pratique.
    expect(sheet).toContain('.ska-input:focus-visible');
    expect(sheet).not.toMatch(/\.ska-input:focus\s*\{\s*outline:\s*none/);
  });
});

describe('annonce aux lecteurs d’écran', () => {
  it('nomme la navigation latérale', () => {
    expect(layout()).toMatch(/<nav[^>]*aria-label="Main"/);
  });

  it('associe chaque en-tête de colonne à sa colonne', () => {
    expect(list()).toMatch(/<th[^>]*scope="col"/);
  });

  it('annonce le compte rendu d’une suppression', () => {
    const html = list(new URL('https://x.test/admin/user?deleted=2'));
    expect(html).toMatch(/role="status"/);
  });

  it('annonce un critère refusé', () => {
    const html = render(List, {
      props: {
        model: viewModel,
        items: [],
        pagination: { page: 1, perPage: 20, total: 0 },
        basePath: '/admin',
        config: { prisma: {} } as any,
        currentUrl: new URL('https://x.test/admin/user'),
        sort: { active: null, ignored: true }
      }
    }).body;
    expect(html).toMatch(/role="alert"/);
  });
});

describe('rendu sous contrainte', () => {
  it('replie la mise en page sous 900 px', () => {
    // Sidebar fixe de 260px + `margin-left: 260px` laissait 115px de contenu
    // sur un écran de 375px.
    expect(sheet).toMatch(/@media \(max-width: 900px\)/);
  });

  it('neutralise les transitions quand le mouvement est refusé', () => {
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('laisse la table défiler horizontalement plutôt que déborder', () => {
    expect(sheet).toMatch(/\.ska-table-wrap \{ overflow-x: auto/);
  });
});
