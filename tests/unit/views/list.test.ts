import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import List from '../../../src/lib/server/views/List.svelte';
import { parsePrismaSchema, parseSchemaContent } from '../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../../fixtures/prismaMock.js';
import type { ListQuery } from '../../../src/lib/server/query/listQuery.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const viewModel = { name: 'User', label: 'Users', fields: User.fields, primaryKey: 'id' };
const empty = { prisma: {} } as any;
const items = [{ id: 1, email: 'a@b.c', name: 'A' }, { id: 2, email: 'c@d.e', name: null }];

const renderList = (
  model: any,
  items: any[],
  pagination: any,
  basePath: string,
  config: any,
  query?: ListQuery,
  currentUrl?: URL,
  listFilters?: any[]
) => render(List, { props: { model, items, pagination, basePath, config, query, currentUrl, listFilters } }).body;

const columns = (html: string) =>
  [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);

const noQuery: ListQuery = { q: null, searchFields: [], filters: [], ignored: [] };

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
    // Sans configuration, les 6 premières colonnes retenues sont les scalaires du
    // modèle amputés de `password` : c'est le filtre annoncé par le README, sans
    // lequel une empreinte de mot de passe se retrouvait en clair dans la liste.
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(columns(html)).toEqual(['id', 'email', 'name', 'bio', 'role', 'is Active', 'Actions']);
    expect(columns(html)).not.toContain('password');
  });

  it('affiche un champ sensible nommé explicitement dans listFields', () => {
    // L'échappatoire : nommer le champ est une intention explicite, elle gagne.
    // C'est aussi le seul recours pour un nom anodin attrapé par la
    // correspondance en sous-chaîne — voir le test `hashtag` ci-dessous.
    const config = { prisma: {}, models: { User: { listFields: ['email', 'password'] } } } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'password', 'Actions']);
  });

  it('garde `hidden` prioritaire sur un listFields explicite', () => {
    // La précédence documentée : `listFields` court-circuite le filtre par nom
    // sensible, mais jamais `hidden`, qui est un refus explicite. Sans cette
    // assertion, inverser les deux conditions du prédicat laissait passer la
    // colonne `password` avec la suite entière au vert.
    const config = {
      prisma: {},
      models: { User: { hidden: ['password'], listFields: ['email', 'password'] } }
    } as any;
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'Actions']);
  });

  it('affiche un nom anodin attrapé par la sous-chaîne quand il est listé', () => {
    // `hashtag` contient 'hash' : sans échappatoire, la colonne serait
    // définitivement invisible et l'utilisateur n'aurait aucun moyen de le voir.
    // Schéma local : la fixture est partagée par une dizaine de fichiers de test.
    const local = parseSchemaContent(
      'model Note {\n  id Int @id\n  email String\n  hashtag String?\n}'
    ).models[0];
    const noteModel = { name: 'Note', label: 'Notes', fields: local.fields, primaryKey: 'id' };
    const config = { prisma: {}, models: { Note: { listFields: ['email', 'hashtag'] } } } as any;
    const html = renderList(noteModel, [{ id: 1 }], { page: 1, perPage: 20, total: 1 }, '/admin', config);
    expect(columns(html)).toEqual(['email', 'hashtag', 'Actions']);
  });

  it('masque un nom anodin attrapé par la sous-chaîne sans listFields', () => {
    // Le défaut reste protégé : sans configuration, le filtre s'applique.
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
    // seul `email` survit : metadata est Json, avatar est Bytes, posts est une relation
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
    // La PK vient de la base : un guillemet y ferme l'attribut et laisse injecter
    // du HTML dans le lien comme dans l'action du formulaire de suppression.
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

describe('List.svelte — recherche et filtres (query/currentUrl)', () => {
  const url = (s: string) => new URL(s, 'http://localhost');

  it('sans query ni currentUrl : pas de barre de recherche (rétrocompat des tests directs)', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty);
    expect(html).not.toContain('ska-search');
  });

  it('query fourni mais searchFields vide : pas de barre de recherche rendue', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, noQuery, url('http://localhost/admin/user'));
    expect(html).not.toContain('ska-search__input');
  });

  it('searchFields non vide : la barre de recherche est rendue avec la valeur courante', () => {
    const query: ListQuery = { q: 'hello', searchFields: ['email'], filters: [], ignored: [] };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query, url('http://localhost/admin/user?q=hello'));
    expect(html).toContain('name="q"');
    expect(html).toContain('value="hello"');
  });

  it('la barre de recherche préserve les filtres actifs en hidden inputs', () => {
    const query: ListQuery = {
      q: null, searchFields: ['email'], ignored: [],
      filters: [{ field: 'published', op: 'equals', value: true, raw: 'true' }]
    };
    const html = renderList(
      viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty,
      query, url('http://localhost/admin/user?f.published=true')
    );
    expect(html).toContain('<input type="hidden" name="f.published" value="true"');
  });

  it('query fourni sans currentUrl : pas de hidden params (robustesse de l\'API du composant)', () => {
    // Cas défensif, sans équivalent en usage réel (le handler passe toujours
    // query et currentUrl ensemble) : couvre le composant utilisé isolément,
    // avec un contrat de props partiellement respecté.
    const query: ListQuery = { q: null, searchFields: ['email'], filters: [], ignored: [] };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query);
    expect(html).toContain('ska-search__input');
    expect(html).not.toContain('type="hidden" name="f.');
  });

  it('la barre de recherche échappe une valeur q contenant du HTML', () => {
    const query: ListQuery = { q: '<script>alert(1)</script>', searchFields: ['email'], filters: [], ignored: [] };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query, url('http://localhost/admin/user'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script');
  });

  it('aucun critère actif : pas de lien "Clear all filters"', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, noQuery, url('http://localhost/admin/user'));
    expect(html).not.toContain('Clear all filters');
  });

  it('q actif : le lien "Clear all filters" est rendu, pointant sur le path nu', () => {
    const query: ListQuery = { q: 'hello', searchFields: ['email'], filters: [], ignored: [] };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query, url('http://localhost/admin/user?q=hello'));
    expect(html).toContain('Clear all filters');
    expect(html).toContain('href="/admin/user"');
  });

  it('un filtre actif (sans q) rend aussi "Clear all filters"', () => {
    const query: ListQuery = {
      q: null, searchFields: [], ignored: [],
      filters: [{ field: 'published', op: 'equals', value: true, raw: 'true' }]
    };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query, url('http://localhost/admin/user?f.published=true'));
    expect(html).toContain('Clear all filters');
  });

  it('un filtre gte EXPLICITE (date brute, pas un preset) n\'active aucune entrée de la sidebar', () => {
    // activeFilterValues ne retient un `gte` que si son `raw` est un des 4
    // presets DateTime connus (voir le test dédié ci-dessous) — un `gte`
    // manuel comme `?f.createdAt__gte=2024-01-01` n'a pas d'équivalent dans
    // la sidebar Boolean/enum/datetime-presets, donc il ne doit jamais y
    // être ajouté par erreur.
    const query: ListQuery = {
      q: null, searchFields: [], ignored: [],
      filters: [{ field: 'createdAt', op: 'gte', value: new Date('2024-01-01'), raw: '2024-01-01' }]
    };
    const html = renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty, query, url('http://localhost/admin/user?f.createdAt__gte=2024-01-01'));
    expect(html).toContain('Clear all filters');
  });

  it('un raccourci DateTime actif (preset) marque bien l\'entrée sidebar correspondante (bug trouvé en review)', () => {
    // parseListQuery sort un raccourci DateTime avec op:'gte' mais raw
    // reste le NOM du preset ('year'), jamais la date calculée — c'est ce
    // qui permet à activeFilterValues de le distinguer d'un gte manuel et
    // de marquer la bonne option comme active (aria-current, §3.4).
    const query: ListQuery = {
      q: null, searchFields: [], ignored: [],
      filters: [{ field: 'createdAt', op: 'gte', value: { gte: new Date('2026-01-01'), lt: new Date('2027-01-01') }, raw: 'year' }]
    };
    const listFilters = [{ field: 'createdAt', label: 'Created', kind: 'datetime' as const, presets: ['today', 'year'] as const }];
    const html = renderList(
      viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty,
      query, url('http://localhost/admin/user?f.createdAt=year'), listFilters as any
    );
    expect(html).toMatch(/href="\/admin\/user\?f\.createdAt=year" class="ska-filters__link ska-filters__link--active" aria-current="page"/);
  });

  it('sidebar rendue (listFilters non vide) sans query : activeFilterValues retombe sur une Map vide', () => {
    // Couvre `query?.filters ?? []` côté `undefined` : le composant peut
    // être utilisé isolément avec listFilters fourni mais query absent —
    // aucune entrée ne doit être marquée active, et surtout pas de throw.
    const listFilters = [{ field: 'role', label: 'Role', kind: 'boolean' as const }];
    const html = renderList(
      viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty,
      undefined, url('http://localhost/admin/user'), listFilters
    );
    expect(html).toContain('ska-filters__group');
    expect(html).toMatch(/href="\/admin\/user" class="ska-filters__link ska-filters__link--active"/);
  });

  it('état vide avec critères actifs : message dédié, pas le message générique', () => {
    const query: ListQuery = { q: 'nomatch', searchFields: ['email'], filters: [], ignored: [] };
    const html = renderList(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty, query, url('http://localhost/admin/user?q=nomatch'));
    expect(html).toContain('No results for these criteria');
    expect(html).not.toContain('No records found');
  });

  it('état vide sans critère : message générique inchangé', () => {
    const html = renderList(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty, noQuery, url('http://localhost/admin/user'));
    expect(html).toContain('No records found');
  });

  it('pagination : sans currentUrl, retombe sur le format legacy ?page=N', () => {
    const html = renderList(viewModel, items, { page: 1, perPage: 2, total: 10 }, '/admin', empty);
    expect(html).toContain('href="?page=2"');
  });

  it('pagination : avec currentUrl, construit une URL absolue via buildListUrl (conserve les autres params)', () => {
    const html = renderList(
      viewModel, items, { page: 1, perPage: 2, total: 10 }, '/admin', empty,
      noQuery, url('http://localhost/admin/user?f.published=true')
    );
    expect(html).toContain('href="/admin/user?f.published=true&amp;page=2"');
  });

  it('pagination : le lien Previous passe aussi par buildListUrl', () => {
    const html = renderList(
      viewModel, items, { page: 3, perPage: 2, total: 10 }, '/admin', empty,
      noQuery, url('http://localhost/admin/user')
    );
    expect(html).toContain('href="/admin/user?page=2"');
    expect(html).toContain('href="/admin/user?page=4"');
  });
});
