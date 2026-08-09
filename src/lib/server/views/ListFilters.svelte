<script lang="ts">
  import type { ResolvedFilterField } from '../query/filterDetection.js';
  import type { FkFilterMeta } from './types.js';
  import { buildListUrl, hiddenParams } from '../query/urls.js';

  /**
   * Sidebar de filtres façon Django admin. Boolean/enum/datetime rendus en
   * liens (§3.1 : zéro JS, un clic = un état). Les plages numériques et les
   * FK à forte cardinalité utilisent un `<form method="GET">` avec bouton
   * explicite — la seule exception documentée au rendu en liens, qui reste
   * fonctionnelle sans JavaScript (§3.2).
   */
  let {
    filters,
    activeValues,
    activeRangeValues,
    fkFilterMeta,
    currentUrl
  }: {
    filters: ResolvedFilterField[];
    /** Valeur brute active par champ (Boolean/enum/datetime/FK), telle qu'apparue dans l'URL. */
    activeValues: Map<string, string>;
    /** Bornes actives par champ range, ex. { views: { gte: '10', lte: '100' } }. */
    activeRangeValues: Map<string, { gte?: string; lte?: string }>;
    /** Résolution async, scopée, des FK configurées. */
    fkFilterMeta: Map<string, FkFilterMeta>;
    currentUrl: URL;
  } = $props();

  interface Option {
    label: string;
    href: string;
    active: boolean;
    /** Valeur brute envoyée dans `f.<field>` ; null représente l'option All. */
    value: string | null;
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

  interface FkGroup {
    kind: 'fk';
    field: string;
    label: string;
    mode: 'links' | 'select' | 'raw-id';
    options: Option[];
    inputValue: string;
    hidden: { name: string; value: string }[];
    activeLabel?: string;
    activeHref?: string;
    clearHref: string;
  }

  const PRESET_LABELS: Record<string, string> = {
    today: 'Today',
    '7d': 'Last 7 days',
    month: 'This month',
    year: 'This year'
  };

  const groups = $derived.by((): (LinkGroup | RangeGroup | FkGroup)[] => {
    return filters.flatMap((f): (LinkGroup | RangeGroup | FkGroup)[] => {
      const paramName = `f.${f.field}`;

      if (f.kind === 'fk') {
        const meta = fkFilterMeta.get(f.field);
        // Résolution async indisponible (client Prisma incomplet, modèle
        // cible absent...) : ne pas afficher un filtre mort. Le filtre URL
        // reste accepté par parseListQuery, mais l'UI ne l'invente pas.
        if (!meta) return [];
        const current = activeValues.get(f.field);
        const allOption: Option = {
          label: 'All',
          href: buildListUrl(currentUrl, { [paramName]: null }),
          active: current === undefined,
          value: null
        };
        const options = meta.options.map((o) => ({
          label: o.label,
          href: buildListUrl(currentUrl, { [paramName]: String(o.id) }),
          active: current === String(o.id),
          value: String(o.id)
        }));
        return [{
          kind: 'fk',
          field: f.field,
          label: f.label,
          mode: meta.mode,
          options: [allOption, ...options],
          inputValue: current ?? '',
          hidden: hiddenParams(currentUrl, [paramName]),
          // Une valeur forgée hors scope a activeLabel undefined : afficher
          // l'ID brut dans le chip, jamais un label qui fuit un autre tenant.
          activeLabel: current === undefined ? undefined : meta.activeLabel ?? current,
          activeHref: meta.activeHref,
          clearHref: buildListUrl(currentUrl, { [paramName]: null })
        }];
      }

      if (f.kind === 'range') {
        const gteParam = `f.${f.field}__gte`;
        const lteParam = `f.${f.field}__lte`;
        const active = activeRangeValues.get(f.field);
        return [{
          kind: 'range',
          field: f.field,
          label: f.label,
          gteParam,
          lteParam,
          gteValue: active?.gte ?? '',
          lteValue: active?.lte ?? '',
          hidden: hiddenParams(currentUrl, [gteParam, lteParam])
        }];
      }

      const current = activeValues.get(f.field);
      const allOption: Option = {
        label: 'All',
        href: buildListUrl(currentUrl, { [paramName]: null }),
        active: current === undefined,
        value: null
      };

      let valueOptions: Option[];
      if (f.kind === 'boolean') {
        valueOptions = [
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' }
        ].map((o) => ({
          label: o.label,
          href: buildListUrl(currentUrl, { [paramName]: o.value }),
          active: current === o.value,
          value: o.value
        }));
      } else if (f.kind === 'datetime') {
        valueOptions = (f.presets ?? []).map((p) => ({
          label: PRESET_LABELS[p] ?? p,
          href: buildListUrl(currentUrl, { [paramName]: p }),
          active: current === p,
          value: p
        }));
      } else {
        valueOptions = (f.enumValues ?? []).map((v) => ({
          label: v,
          href: buildListUrl(currentUrl, { [paramName]: v }),
          active: current === v,
          value: v
        }));
      }

      return [{ kind: 'links', field: f.field, label: f.label, options: [allOption, ...valueOptions] }];
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

        {:else if group.kind === 'fk' && group.activeLabel}
          <p class="ska-filters__chip">
            {#if group.activeHref}
              <a href={group.activeHref}>{group.activeLabel}</a>
            {:else}
              <span>{group.activeLabel}</span>
            {/if}
            <a href={group.clearHref} class="ska-filters__chip-clear" aria-label={`Clear ${group.label}`}>×</a>
          </p>
        {/if}

        {#if group.kind === 'fk' && group.mode === 'select'}
          <form method="GET" class="ska-filters__select">
            {#each group.hidden as p (p.name)}
              <input type="hidden" name={p.name} value={p.value} />
            {/each}
            <select name={`f.${group.field}`} class="ska-filters__select-input">
              {#each group.options as option (option.label)}
                <option value={option.value ?? ''} selected={option.active}>{option.label}</option>
              {/each}
            </select>
            <button type="submit" class="ska-btn ska-btn--secondary ska-btn--sm">Apply</button>
          </form>

        {:else if group.kind === 'fk' && group.mode === 'raw-id'}
          <form method="GET" class="ska-filters__range">
            {#each group.hidden as p (p.name)}
              <input type="hidden" name={p.name} value={p.value} />
            {/each}
            <input
              type="text"
              name={`f.${group.field}`}
              value={group.inputValue}
              placeholder="ID"
              class="ska-filters__range-input"
            />
            <button type="submit" class="ska-btn ska-btn--secondary ska-btn--sm">Apply</button>
          </form>

        {:else if group.kind === 'links' || (group.kind === 'fk' && group.mode === 'links')}
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
