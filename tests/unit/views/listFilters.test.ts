import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ListFilters from '../../../src/lib/server/views/ListFilters.svelte';
import type { ResolvedFilterField } from '../../../src/lib/server/query/filterDetection.js';

const renderFilters = (
  filters: ResolvedFilterField[],
  activeValues: Map<string, string>,
  currentUrl: URL
) => render(ListFilters, { props: { filters, activeValues, currentUrl } }).body;

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
