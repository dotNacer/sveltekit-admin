<script lang="ts">
  import type { ResolvedFilterField } from '../query/filterDetection.js';
  import { buildListUrl } from '../query/urls.js';

  /**
   * Sidebar de filtres façon Django admin : des liens, pas un formulaire.
   * Un clic = un état, l'état est dans l'URL (partageable, bookmarkable,
   * le bouton Retour fonctionne). Zéro JS requis — voir
   * docs/design/list-search-filters.md §3.1 pour le rejet explicite du
   * `<select onchange="submit()">`.
   */
  let {
    filters,
    activeValues,
    currentUrl
  }: {
    filters: ResolvedFilterField[];
    /** Valeur brute active par champ, telle qu'apparue dans l'URL — absente si le filtre n'est pas actif. */
    activeValues: Map<string, string>;
    currentUrl: URL;
  } = $props();

  interface Option {
    label: string;
    href: string;
    active: boolean;
  }

  interface Group {
    field: string;
    label: string;
    options: Option[];
  }

  const groups = $derived.by((): Group[] => {
    return filters.map((f): Group => {
      const paramName = `f.${f.field}`;
      const current = activeValues.get(f.field);

      const allOption: Option = {
        label: 'All',
        href: buildListUrl(currentUrl, { [paramName]: null }),
        active: current === undefined
      };

      const valueOptions: Option[] =
        f.kind === 'boolean'
          ? [
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' }
            ].map((o) => ({
              label: o.label,
              href: buildListUrl(currentUrl, { [paramName]: o.value }),
              active: current === o.value
            }))
          : (f.enumValues ?? []).map((v) => ({
              label: v,
              href: buildListUrl(currentUrl, { [paramName]: v }),
              active: current === v
            }));

      return { field: f.field, label: f.label, options: [allOption, ...valueOptions] };
    });
  });
</script>

{#if groups.length > 0}
  <div class="ska-card ska-filters">
    {#each groups as group (group.field)}
      <div class="ska-filters__group">
        <h3 class="ska-filters__title">{group.label}</h3>
        <ul class="ska-filters__list">
          {#each group.options as option (option.label)}
            <li>
              <a
                href={option.href}
                class="ska-filters__link"
                class:ska-filters__link--active={option.active}
                aria-current={option.active ? 'page' : undefined}
              >
                {option.label}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
{/if}
