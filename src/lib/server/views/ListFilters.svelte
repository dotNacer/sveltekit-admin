<script lang="ts">
  import type { ResolvedFilterField } from '../query/filterDetection.js';
  import { buildListUrl, hiddenParams } from '../query/urls.js';

  /**
   * Sidebar de filtres façon Django admin. Boolean/enum/datetime rendus en
   * liens (§3.1 : zéro JS, un clic = un état). Les plages numériques
   * (`range: true`) sont l'exception documentée (§3.2) : deux bornes ne se
   * réduisent pas à un ensemble fini de liens, donc un mini `<form
   * method="GET">` avec bouton "Appliquer" explicite, qui fonctionne à 100%
   * sans JS.
   */
  let {
    filters,
    activeValues,
    activeRangeValues,
    currentUrl
  }: {
    filters: ResolvedFilterField[];
    /** Valeur brute active par champ (kind boolean/enum/datetime), telle qu'apparue dans l'URL. */
    activeValues: Map<string, string>;
    /** Bornes actives par champ range, ex. { views: { gte: '10', lte: '100' } }. */
    activeRangeValues: Map<string, { gte?: string; lte?: string }>;
    currentUrl: URL;
  } = $props();

  interface Option {
    label: string;
    href: string;
    active: boolean;
  }

  interface LinkGroup {
    kind: 'links';
    field: string;
    label: string;
    options: Option[];
  }

  interface RangeGroup {
    kind: 'range';
    field: string;
    label: string;
    gteParam: string;
    lteParam: string;
    gteValue: string;
    lteValue: string;
    hidden: { name: string; value: string }[];
  }

  const PRESET_LABELS: Record<string, string> = {
    today: 'Today',
    '7d': 'Last 7 days',
    month: 'This month',
    year: 'This year'
  };

  const groups = $derived.by((): (LinkGroup | RangeGroup)[] => {
    return filters.map((f): LinkGroup | RangeGroup => {
      const paramName = `f.${f.field}`;

      if (f.kind === 'range') {
        const gteParam = `f.${f.field}__gte`;
        const lteParam = `f.${f.field}__lte`;
        const active = activeRangeValues.get(f.field);
        return {
          kind: 'range',
          field: f.field,
          label: f.label,
          gteParam,
          lteParam,
          gteValue: active?.gte ?? '',
          lteValue: active?.lte ?? '',
          hidden: hiddenParams(currentUrl, [gteParam, lteParam])
        };
      }

      const current = activeValues.get(f.field);
      const allOption: Option = {
        label: 'All',
        href: buildListUrl(currentUrl, { [paramName]: null }),
        active: current === undefined
      };

      let valueOptions: Option[];
      if (f.kind === 'boolean') {
        valueOptions = [
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' }
        ].map((o) => ({
          label: o.label,
          href: buildListUrl(currentUrl, { [paramName]: o.value }),
          active: current === o.value
        }));
      } else if (f.kind === 'datetime') {
        valueOptions = (f.presets ?? []).map((p) => ({
          label: PRESET_LABELS[p] ?? p,
          href: buildListUrl(currentUrl, { [paramName]: p }),
          active: current === p
        }));
      } else {
        valueOptions = (f.enumValues ?? []).map((v) => ({
          label: v,
          href: buildListUrl(currentUrl, { [paramName]: v }),
          active: current === v
        }));
      }

      return { kind: 'links', field: f.field, label: f.label, options: [allOption, ...valueOptions] };
    });
  });
</script>

{#if groups.length > 0}
  <div class="ska-card ska-filters">
    {#each groups as group (group.field)}
      <div class="ska-filters__group">
        <h3 class="ska-filters__title">{group.label}</h3>
        {#if group.kind === 'range'}
          <form method="GET" class="ska-filters__range">
            {#each group.hidden as p (p.name)}
              <input type="hidden" name={p.name} value={p.value} />
            {/each}
            <input
              type="number"
              name={group.gteParam}
              value={group.gteValue}
              placeholder="Min"
              class="ska-filters__range-input"
            />
            <input
              type="number"
              name={group.lteParam}
              value={group.lteValue}
              placeholder="Max"
              class="ska-filters__range-input"
            />
            <button type="submit" class="ska-btn ska-btn--secondary ska-btn--sm">Apply</button>
          </form>
        {:else}
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
        {/if}
      </div>
    {/each}
  </div>
{/if}

