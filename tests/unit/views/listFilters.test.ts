import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ListFilters from '../../../src/lib/server/views/ListFilters.svelte';
import type { ResolvedFilterField } from '../../../src/lib/server/query/filterDetection.js';

const renderFilters = (
  filters: ResolvedFilterField[],
  activeValues: Map<string, string>,
  currentUrl: URL,
  activeRangeValues: Map<string, { gte?: string; lte?: string }> = new Map()
) => render(ListFilters, { props: { filters, activeValues, activeRangeValues, currentUrl } }).body;

describe('ListFilters.svelte', () => {
  it('vide : ne rend rien', () => {
    const html = renderFilters([], new Map(), new URL('http://localhost/admin/user'));
    expect(html).not.toContain('ska-filters__group');
  });

  it('un groupe Boolean : options All/Yes/No', () => {
    const html = renderFilters(
      [{ field: 'published', label: 'Published', kind: 'boolean' }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('Published');
    expect(html).toContain('>All<');
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    expect(html).toContain('href="/admin/post?f.published=true"');
    expect(html).toContain('href="/admin/post?f.published=false"');
  });

  it('un groupe enum : une option par membre', () => {
    const html = renderFilters(
      [{ field: 'status', label: 'Status', kind: 'enum', enumValues: ['DRAFT', 'PUBLISHED'] }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('>DRAFT<');
    expect(html).toContain('>PUBLISHED<');
    expect(html).toContain('href="/admin/post?f.status=DRAFT"');
  });

  it('groupe enum sans enumValues (cas défensif) : aucune option de valeur, seulement "All"', () => {
    // Ne devrait jamais arriver via resolveListFilters (qui fournit toujours
    // enumValues pour kind:'enum'), mais le composant ne doit pas planter
    // si utilisé isolément avec un objet mal formé.
    const html = renderFilters(
      [{ field: 'status', label: 'Status', kind: 'enum' }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    const options = [...html.matchAll(/class="ska-filters__link[^"]*"/g)];
    expect(options).toHaveLength(1); // seulement "All"
  });

  it('active la bonne option quand une valeur est déjà sélectionnée', () => {
    const html = renderFilters(
      [{ field: 'status', label: 'Status', kind: 'enum', enumValues: ['DRAFT', 'PUBLISHED'] }],
      new Map([['status', 'DRAFT']]),
      new URL('http://localhost/admin/post?f.status=DRAFT')
    );
    expect(html).toMatch(/href="\/admin\/post\?f\.status=DRAFT" class="ska-filters__link ska-filters__link--active" aria-current="page"/);
    expect(html).not.toMatch(/href="\/admin\/post" class="ska-filters__link ska-filters__link--active"/);
  });

  it('plusieurs groupes sont tous rendus', () => {
    const html = renderFilters(
      [
        { field: 'published', label: 'Published', kind: 'boolean' },
        { field: 'status', label: 'Status', kind: 'enum', enumValues: ['DRAFT'] }
      ],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('Published');
    expect(html).toContain('Status');
  });
});

describe('ListFilters.svelte — datetime (presets)', () => {
  it('rend une option par preset, avec le libellé humain', () => {
    const html = renderFilters(
      [{ field: 'createdAt', label: 'Created', kind: 'datetime', presets: ['today', '7d', 'month', 'year'] }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('>Today<');
    expect(html).toContain('>Last 7 days<');
    expect(html).toContain('>This month<');
    expect(html).toContain('>This year<');
    expect(html).toContain('href="/admin/post?f.createdAt=today"');
  });

  it('respecte un sous-ensemble de presets configuré', () => {
    const html = renderFilters(
      [{ field: 'createdAt', label: 'Created', kind: 'datetime', presets: ['today'] }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('>Today<');
    expect(html).not.toContain('>Last 7 days<');
  });

  it('marque le preset actif', () => {
    const html = renderFilters(
      [{ field: 'createdAt', label: 'Created', kind: 'datetime', presets: ['today', '7d'] }],
      new Map([['createdAt', '7d']]),
      new URL('http://localhost/admin/post?f.createdAt=7d')
    );
    expect(html).toMatch(/href="\/admin\/post\?f\.createdAt=7d" class="ska-filters__link ska-filters__link--active" aria-current="page"/);
  });

  it('sans presets (cas défensif) : seulement "All"', () => {
    const html = renderFilters(
      [{ field: 'createdAt', label: 'Created', kind: 'datetime' }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    const options = [...html.matchAll(/class="ska-filters__link[^"]*"/g)];
    expect(options).toHaveLength(1);
  });

  it('preset inconnu (cas défensif, hors des 4 valeurs standard) : affiché tel quel', () => {
    // Ne devrait jamais arriver via resolveListFilters (qui valide les
    // presets au boot), mais PRESET_LABELS a un fallback pour ne jamais
    // planter sur un composant utilisé isolément avec des données custom.
    const html = renderFilters(
      [{ field: 'createdAt', label: 'Created', kind: 'datetime', presets: ['unknownPreset' as any] }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('>unknownPreset<');
  });
});

describe('ListFilters.svelte — range (plages numériques)', () => {
  it('rend un mini form GET avec deux inputs number et un bouton Apply', () => {
    const html = renderFilters(
      [{ field: 'views', label: 'Views', kind: 'range' }],
      new Map(),
      new URL('http://localhost/admin/post')
    );
    expect(html).toContain('method="GET"');
    expect(html).toContain('name="f.views__gte"');
    expect(html).toContain('name="f.views__lte"');
    expect(html).toContain('placeholder="Min"');
    expect(html).toContain('placeholder="Max"');
    expect(html).toContain('>Apply<');
  });

  it('préremplit les bornes actives', () => {
    const html = renderFilters(
      [{ field: 'views', label: 'Views', kind: 'range' }],
      new Map(),
      new URL('http://localhost/admin/post?f.views__gte=10&f.views__lte=100'),
      new Map([['views', { gte: '10', lte: '100' }]])
    );
    expect(html).toContain('value="10"');
    expect(html).toContain('value="100"');
  });

  it('une seule borne active : l\'autre input reste vide', () => {
    const html = renderFilters(
      [{ field: 'views', label: 'Views', kind: 'range' }],
      new Map(),
      new URL('http://localhost/admin/post?f.views__gte=10'),
      new Map([['views', { gte: '10' }]])
    );
    expect(html).toContain('name="f.views__gte" value="10"');
    expect(html).toContain('name="f.views__lte" value=""');
  });

  it('préserve les autres params actifs (q, autre filtre) en hidden inputs', () => {
    const html = renderFilters(
      [{ field: 'views', label: 'Views', kind: 'range' }],
      new Map(),
      new URL('http://localhost/admin/post?q=hello&f.published=true')
    );
    expect(html).toContain('<input type="hidden" name="q" value="hello"');
    expect(html).toContain('<input type="hidden" name="f.published" value="true"');
  });

  it('n\'inclut jamais page ni ses propres params (gte/lte) dans les hidden inputs', () => {
    const html = renderFilters(
      [{ field: 'views', label: 'Views', kind: 'range' }],
      new Map(),
      new URL('http://localhost/admin/post?page=3&f.views__gte=5')
    );
    expect(html).not.toContain('name="page"');
    expect(html).not.toContain('name="f.views__gte" value="5"');
    // (le seul input nommé f.views__gte doit être le champ number visible, préempli via gteValue)
  });
});
