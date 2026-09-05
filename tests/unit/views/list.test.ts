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
  listFilters?: any[],
  sort?: any
) => render(List, { props: { model, items, pagination, basePath, config, query, currentUrl, listFilters, sort } }).body;

/**
 * Le libellé d'un en-tête est soit du texte nu (rendu sans `currentUrl`, donc
 * sans lien de tri possible), soit le contenu d'un `<a>`. Les deux formes sont
 * acceptées ici pour que ce helper reste sur le libellé, pas sur le balisage.
 */
const columns = (html: string) =>
  [...html.matchAll(/<th[^>]*>(?:<a[^>]*>)?([^<]*)/g)]
    .map((m) => m[1])
    .filter((label) => label !== '');

const noQuery: ListQuery = { q: null, searchFields: [], filters: [], ignored: [] };

describe('List.svelte', () => {
  it('affiche le nombre total', () => {
    expect(renderList(viewModel, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty))
      .toContain('2 records');
  });

  it('utilise le pluriel pour le titre et le singulier pour Ajouter', () => {
    const html = renderList(
      { ...viewModel, singularLabel: 'Account', pluralLabel: 'Accounts' },
      [], { page: 1, perPage: 20, total: 0 }, '/admin', empty
    );
    expect(html).toContain('<h1>Accounts</h1>');
    expect(html).toContain('Add Account');
    expect(html).not.toContain('Add Accounts');
  });

  it('rend les colonnes dans l’ordre fourni par le ViewModel', () => {
    const ordered = {
      ...viewModel,
      fields: [User.fields.find((f) => f.name === 'name')!, User.fields.find((f) => f.name === 'email')!]
    };
    expect(columns(renderList(ordered, items, { page: 1, perPage: 20, total: 2 }, '/admin', empty)))
      .toEqual(['name', 'email', 'Actions']);
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
    expect(html).toMatch(/class="ska-filters__group"/);
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

describe('List.svelte — recordActions', () => {
  const pagination = { page: 1, perPage: 20, total: 2 };

  it('n’ajoute pas de lien plugin par défaut', () => {
    const html = renderList(viewModel, items, pagination, '/admin', empty);
    expect(html).not.toContain('/admin/user/1/graph');
    expect(html).toContain('>Edit</a>');
  });

  it('appelle hrefFor avec la PK et rend le lien avant Edit', () => {
    const html = render(List, {
      props: {
        model: viewModel,
        items,
        pagination,
        basePath: '/admin',
        config: empty,
        recordActions: [
          { label: '<img>', hrefFor: (id) => `/admin/user/${id}/graph` }
        ]
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph"');
    expect(html).toContain('href="/admin/user/2/graph"');
    // escapeHtml (unlike Svelte's default text-escaping) also escapes `>` — this now
    // renders via {@html} + escapeHtml (see fix-round-1 notes), not Svelte text interpolation.
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
    expect(html).not.toMatch(/<td class="ska-table__actions">[^<]*<img>/);
    const row1 = html.slice(html.indexOf('a@b.c'));
    const graphAt = row1.indexOf('href="/admin/user/1/graph"');
    const editAt = row1.indexOf('>Edit</a>');
    expect(graphAt).toBeGreaterThan(-1);
    expect(graphAt).toBeLessThan(editAt);
  });

  it('échappe un hrefFor malveillant contenant des guillemets/chevrons', () => {
    const html = render(List, {
      props: {
        model: viewModel,
        items,
        pagination,
        basePath: '/admin',
        config: empty,
        recordActions: [
          { label: 'Graph', hrefFor: (id) => `/admin/user/${id}/graph" onclick="alert(1)` }
        ]
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph&quot; onclick=&quot;alert(1)"');
    expect(html).not.toContain('href="/admin/user/1/graph" onclick="alert(1)"');
  });

  it('ne change pas le colspan de la row vide', () => {
    const html = renderList(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty);
    expect(html).toMatch(/colspan="7"/);
  });
});

describe('List.svelte — tri de colonnes', () => {
  const url = new URL('https://x.test/admin/user');
  const sorted = (field: string, dir: 'asc' | 'desc') => ({
    active: { field, dir },
    ignored: false
  });
  const unsorted = { active: null, ignored: false };
  const page = { page: 1, perPage: 20, total: 2 };

  it('rend chaque en-tête comme un lien de tri', () => {
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, url, undefined, unsorted);
    expect(html).toMatch(/<th[^>]*><a href="\/admin\/user\?sort=email"/);
  });

  it('inverse la direction sur la colonne déjà triée', () => {
    const active = new URL('https://x.test/admin/user?dir=asc&sort=email');
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, active, undefined, sorted('email', 'asc'));
    expect(html).toContain('href="/admin/user?dir=desc&amp;sort=email"');
  });

  it('repart en ascendant sur une colonne non triée', () => {
    const active = new URL('https://x.test/admin/user?dir=desc&sort=email');
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, active, undefined, sorted('email', 'desc'));
    expect(html).toContain('href="/admin/user?sort=name"');
  });

  it('annonce la colonne triée avec aria-sort', () => {
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, url, undefined, sorted('email', 'asc'));
    expect(html).toMatch(/<th[^>]*aria-sort="ascending"[^>]*><a[^>]*>email/);
  });

  it('annonce la direction descendante', () => {
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, url, undefined, sorted('email', 'desc'));
    expect(html).toContain('aria-sort="descending"');
  });

  it('marque les autres colonnes comme non triées', () => {
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, url, undefined, sorted('email', 'asc'));
    expect(html).toContain('aria-sort="none"');
  });

  it('retombe sur la première page en changeant de tri', () => {
    // Trier sur 25 lignes depuis la page 3 n'a aucune raison de rester page 3 :
    // ce ne sont plus les mêmes lignes.
    const paged = new URL('https://x.test/admin/user?page=3');
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, paged, undefined, unsorted);
    expect(html).not.toContain('page=3&amp;sort=email');
  });

  it('conserve la recherche active en changeant de tri', () => {
    const searched = new URL('https://x.test/admin/user?q=bob');
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, searched, undefined, unsorted);
    expect(html).toContain('href="/admin/user?q=bob&amp;sort=email"');
  });

  it('explique un tri refusé sans nommer de raison', () => {
    const html = renderList(viewModel, items, page, '/admin', empty, noQuery, url, undefined, {
      active: null,
      ignored: true
    });
    expect(html).toContain('Ignored sort');
  });

  it('ne rend aucun lien de tri sans URL courante', () => {
    const html = renderList(viewModel, items, page, '/admin', empty);
    expect(html).toContain('<th scope="col">email</th>');
  });
});

describe('List.svelte — pagination', () => {
  const url = new URL('https://x.test/admin/user');
  const render20 = (page: number) =>
    renderList(viewModel, items, { page, perPage: 2, total: 40 }, '/admin', empty, noQuery, url);

  it('rend les numéros de page en liens', () => {
    const html = render20(10);
    expect(html).toContain('href="/admin/user?page=9"');
    expect(html).toContain('href="/admin/user?page=11"');
  });

  it('marque la page courante sans en faire un lien', () => {
    const html = render20(10);
    expect(html).toMatch(/aria-current="page"[^>]*>10</);
    expect(html).not.toContain('href="/admin/user?page=10"');
  });

  it('rend les trous sans lien', () => {
    const html = render20(10);
    expect(html).toContain('…');
    expect(html).not.toContain('href="/admin/user?page=gap"');
  });

  it('donne accès à la première et à la dernière page', () => {
    const html = render20(10);
    expect(html).toContain('href="/admin/user?page=1"');
    expect(html).toContain('href="/admin/user?page=20"');
  });

  it('nomme la navigation pour les lecteurs d’écran', () => {
    expect(render20(10)).toContain('aria-label="Pagination"');
  });

  it('conserve la recherche active dans les liens de page', () => {
    const searched = new URL('https://x.test/admin/user?q=bob');
    const html = renderList(viewModel, items, { page: 2, perPage: 2, total: 40 }, '/admin', empty, noQuery, searched);
    expect(html).toContain('page=3&amp;q=bob');
  });
});

describe('List.svelte — suppression en masse', () => {
  const url = new URL('https://x.test/admin/user');
  const page = { page: 1, perPage: 20, total: 2 };
  const render = (currentUrl = url) =>
    renderList(viewModel, items, page, '/admin', empty, noQuery, currentUrl);

  it('rend une case par ligne, portant la clé primaire', () => {
    const html = render();
    expect(html).toContain('name="ids" value="1"');
    expect(html).toContain('name="ids" value="2"');
  });

  it('poste vers la liste avec l’action de masse', () => {
    const html = render();
    expect(html).toContain('value="bulk-delete"');
    expect(html).toContain('action="/admin/user"');
  });

  it('demande confirmation avant de poster', () => {
    expect(render()).toContain('confirm(');
  });

  it('nomme chaque case pour les lecteurs d’écran', () => {
    // Une case sans nom accessible n'est qu'un carré : le lecteur d'écran
    // annoncerait « case à cocher, non cochée » sans dire de quelle ligne.
    expect(render()).toMatch(/aria-label="Select record 1"/);
  });

  it('propose de tout sélectionner sur la page', () => {
    expect(render()).toContain('Select all on this page');
  });

  it('rend le compte rendu de suppression', () => {
    const deleted = new URL('https://x.test/admin/user?deleted=3');
    expect(render(deleted)).toContain('3 records deleted');
  });

  it('accorde le singulier', () => {
    const deleted = new URL('https://x.test/admin/user?deleted=1');
    expect(render(deleted)).toContain('1 record deleted');
  });

  it('ignore un compte rendu non numérique', () => {
    // Le paramètre vient de l'URL : il est rendu, donc il est échappé et
    // validé comme n'importe quelle autre entrée.
    const forged = new URL('https://x.test/admin/user?deleted=<script>');
    const html = render(forged);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('records deleted');
  });

  it('ne rend aucune case sans URL courante', () => {
    const html = renderList(viewModel, items, page, '/admin', empty);
    expect(html).not.toContain('name="ids"');
  });
});
