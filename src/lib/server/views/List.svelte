<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { ViewModel, ListRecordAction, FkFilterMeta } from './types.js';
  import type { ListQuery } from '../query/listQuery.js';
  import type { ResolvedFilterField } from '../query/filterDetection.js';
  import { DATETIME_PRESETS } from '../query/filterDetection.js';
  import { getDisplayFields } from '../introspection/parser.js';
  import { buildListUrl, hiddenParams } from '../query/urls.js';
  import { escapeHtml, toLabel, formatValue } from './html.js';
  import ListFilters from './ListFilters.svelte';

  let {
    model,
    items,
    pagination,
    basePath,
    config,
    query,
    currentUrl,
    listFilters,
    fkFilterMeta,
    recordActions = []
  }: {
    model: ViewModel;
    items: any[];
    pagination: { page: number; perPage: number; total: number };
    basePath: string;
    config: AdminHandlerConfig;
    /** Recherche/filtres actifs, absent quand l'appelant ne les gère pas (rétrocompat des tests directs du composant). */
    query?: ListQuery;
    /** URL de la requête courante — nécessaire pour construire les liens de pagination et le form GET. Absent = pagination legacy `?page=N` isolée. */
    currentUrl?: URL;
    /** Filtres sidebar résolus (Boolean/enum/date/range/FK), absent = pas de sidebar rendue. */
    listFilters?: ResolvedFilterField[];
    /** Métadonnées async (options scopées + label actif) pour les filtres FK configurés. */
    fkFilterMeta?: Map<string, FkFilterMeta>;
    recordActions?: ListRecordAction[];
  } = $props();

  const modelConfig = $derived(config.models?.[model.name] || {});
  const hidden = $derived(modelConfig.hidden || []);
  const listFields = $derived(modelConfig.listFields);

  const displayFields = $derived.by(() => {
    const explicit = new Set(listFields ?? []);
    const safeNames = new Set(getDisplayFields(model).map((f) => f.name));

    let fields = model.fields.filter(
      (f) =>
        (explicit.has(f.name) || safeNames.has(f.name)) &&
        !hidden.includes(f.name) &&
        !f.relation &&
        !['Json', 'Bytes'].includes(f.type)
    );

    if (listFields?.length) {
      fields = fields.filter((f) => listFields.includes(f.name));
    }

    return fields.slice(0, 6);
  });

  const listPath = $derived(`${basePath}/${model.name.toLowerCase()}`);
  const totalPages = $derived(Math.ceil(pagination.total / pagination.perPage));

  // Barre de recherche rendue seulement si des champs sont réellement
  // cherchables pour ce modèle — jamais un input muet qui ne filtre rien
  // (docs/design §2.1).
  const hasSearch = $derived((query?.searchFields.length ?? 0) > 0);
  const hasActiveCriteria = $derived(
    Boolean(query && (query.q || query.filters.length > 0))
  );

  const pageHref = $derived.by(() => {
    if (!currentUrl) return (n: number) => `?page=${n}`;
    return (n: number) => buildListUrl(currentUrl, { page: String(n) });
  });
  const clearHref = $derived(currentUrl ? currentUrl.pathname : listPath);
  const searchHiddenParams = $derived(currentUrl ? hiddenParams(currentUrl, ['q']) : []);

  /** Valeur brute active par champ (pour marquer l'option correspondante dans la sidebar). */
  const activeFilterValues = $derived.by(() => {
    // Rendu SSR sans hydratation : la Map est construite une fois par
    // render et jamais mutée après coup, SvelteMap n'a aucun intérêt ici.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, string>();
    const presetSet = new Set<string>(DATETIME_PRESETS);
    for (const f of query?.filters ?? []) {
      if (f.op === 'equals') {
        map.set(f.field, f.raw);
      } else if (f.op === 'gte' && presetSet.has(f.raw)) {
        // Un raccourci DateTime (§5.5) sort de parseListQuery avec
        // `op: 'gte'` (le range gte/lt est fusionné dans un seul
        // ActiveFilter) mais `raw` reste le nom du preset d'origine
        // ('today'/'7d'/'month'/'year'), jamais la date calculée — c'est
        // ce qui permet de le distinguer d'un `?f.x__gte=<date brute>`
        // manuel, qui lui ne doit JAMAIS marquer une entrée de sidebar
        // active (bug trouvé en review : sans cette distinction, aucun
        // preset actif n'était jamais marqué, régression a11y contre
        // aria-current exigé par §3.4).
        map.set(f.field, f.raw);
      }
    }
    return map;
  });

  /** Bornes gte/lte actives par champ (pour préremplir les inputs "range" de la sidebar). */
  const activeRangeValues = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, { gte?: string; lte?: string }>();
    for (const f of query?.filters ?? []) {
      if (f.op !== 'gte' && f.op !== 'lte') continue;
      const entry = map.get(f.field) ?? {};
      entry[f.op] = f.raw;
      map.set(f.field, entry);
    }
    return map;
  });

  /**
   * Messages « Filtre ignoré : champ "foo" inconnu » rendus pour chaque
   * entrée `query.ignored`. Requis par docs/design §5.4, pour deux
   * raisons : (1) sans ce message l'utilisateur ne comprend pas pourquoi
   * son URL bricolée ne fait rien, (2) ça rend la branche `ignored`
   * observable et testable via le rendu réel plutôt que par un appel
   * unitaire isolé qui contourne le vrai chemin. Le message est le MÊME
   * pour un champ sensible que pour un champ inconnu (§0.a, §5.4) — ne
   * jamais dire "champ interdit", ça confirmerait son existence.
   */
  // A per-row function (rather than {#each} in the markup) so an empty recordActions
  // keeps this to the smallest possible footprint: Svelte 5's SSR wraps every
  // {#each}/{@html} node in its own hydration-boundary comment regardless of the
  // array's length/content (verified empirically — even {@html ''} still emits
  // `<!--hash--><!---->`), so there is no template-level construct that renders zero
  // bytes for an empty array here. Folding this into the pre-existing delete-form
  // {@html} call (right below) was considered and rejected: recordActions must render
  // *before* Edit (see list.test.ts "rend le lien avant Edit"), but the delete form's
  // pre-existing {@html} — and thus its hydration marker — sits *after* Edit, so
  // reusing it would either reorder Edit/recordActions or move the marker in front of
  // Edit for every row, not just when recordActions is non-empty. Neither is
  // byte-identical to the pre-recordActions baseline (see task-6-report.md fix-round-1
  // notes). `action.label` and `hrefFor`'s return value are both escaped manually
  // since this goes through @html instead of Svelte's auto-escaped text/attributes.
  const recordActionsHtml = (id: string | number) =>
    recordActions
      .map(
        (action) =>
          `<a href="${escapeHtml(action.hrefFor(id))}" class="ska-btn ska-btn--secondary ska-btn--sm">${escapeHtml(action.label)}</a>`
      )
      .join('');

  const ignoredMessages = $derived.by(() => {
    return (query?.ignored ?? []).map((entry) => {
      // `param` est soit `f.<field>` / `f.<field>__<op>` (nouveau format),
      // soit littéralement `filter` (legacy `?filter=field:value` — le nom
      // du champ ciblé n'est pas conservé côté IgnoredFilter pour ce
      // chemin, seul le message générique s'applique).
      if (entry.param === 'filter') {
        return { key: entry.param, text: 'Ignored filter: legacy `filter=` value could not be applied' };
      }
      const withoutPrefix = entry.param.slice(2);
      const sep = withoutPrefix.indexOf('__');
      const fieldName = sep === -1 ? withoutPrefix : withoutPrefix.slice(0, sep);
      return { key: entry.param, text: `Ignored filter: field "${fieldName}" unknown` };
    });
  });
</script>

<div class="ska-header">
  <div>
    <h1>{model.label}</h1>
    <p class="ska-subtitle">{pagination.total} records</p>
  </div>
  <a href="{listPath}/new" class="ska-btn ska-btn--primary">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
    Add {model.label}
  </a>
</div>

{#if listFilters && listFilters.length > 0 && currentUrl}
  <ListFilters
    filters={listFilters}
    activeValues={activeFilterValues}
    {activeRangeValues}
    fkFilterMeta={fkFilterMeta ?? new Map()}
    {currentUrl}
  />
{/if}


{#if hasSearch}
  <form method="GET" class="ska-search">
    {#each searchHiddenParams as p (p.name)}
      <input type="hidden" name={p.name} value={p.value} />
    {/each}
    <input
      type="search"
      name="q"
      value={query?.q ?? ''}
      placeholder="Search…"
      class="ska-search__input"
    />
    <button type="submit" class="ska-btn ska-btn--secondary">Search</button>
  </form>
{/if}

{#if ignoredMessages.length > 0}
  <div class="ska-alert ska-alert--error">
    {#each ignoredMessages as m (m.key)}
      <p>{m.text}</p>
    {/each}
  </div>
{/if}

{#if hasActiveCriteria}
  <p class="ska-subtitle">
    <a href={clearHref} class="ska-back">Clear all filters</a>
  </p>
{/if}

<div class="ska-card">
  <div class="ska-table-wrap">
    <table class="ska-table">
      <thead>
        <tr>
          {#each displayFields as f (f.name)}<th>{toLabel(f.name)}</th>{/each}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#if items.length === 0}
          <tr>
            <td colspan={displayFields.length + 1} style="text-align: center; color: #64748b; padding: 2rem;">
              {hasActiveCriteria ? 'No results for these criteria' : 'No records found'}
            </td>
          </tr>
        {:else}
          {#each items as item (item[model.primaryKey])}
            <tr>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- formatValue already escapes string values itself and returns a literal <span> only for null/undefined -->
              {#each displayFields as f (f.name)}<td>{@html formatValue(item[f.name], f.type)}</td>{/each}
              <td class="ska-table__actions">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- recordActionsHtml escapes both action.label and hrefFor's return value via escapeHtml -->
                {@html recordActionsHtml(item[model.primaryKey])}
                <a href="{listPath}/{item[model.primaryKey]}" class="ska-btn ska-btn--secondary ska-btn--sm">Edit</a>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- Svelte 5 rejects a literal onsubmit string as an event attribute; the PK is escaped manually here since it can't go through Svelte's native attribute escaping; the whole form (not just onsubmit) is rendered as raw HTML because there's no native-Svelte way to attach a plain inline onsubmit="..." string attribute at all in Svelte 5 templates, so the whole element had to be raw text to preserve the exact prior confirm-dialog behavior in a page that's never hydrated by a Svelte runtime -->
                {@html `<form method="POST" action="${listPath}/${escapeHtml(String(item[model.primaryKey]))}" style="display:inline" onsubmit="return confirm('Delete this item?')"><input type="hidden" name="_action" value="delete"><button type="submit" class="ska-btn ska-btn--danger ska-btn--sm">Delete</button></form>`}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if totalPages > 1}
    <div class="ska-pagination">
      <span class="ska-pagination__info">
        Showing {(pagination.page - 1) * pagination.perPage + 1} to {Math.min(pagination.page * pagination.perPage, pagination.total)} of {pagination.total}
      </span>
      {#if pagination.page > 1}<a href={pageHref(pagination.page - 1)} class="ska-btn ska-btn--secondary ska-btn--sm">Previous</a>{/if}
      {#if pagination.page < totalPages}<a href={pageHref(pagination.page + 1)} class="ska-btn ska-btn--secondary ska-btn--sm">Next</a>{/if}
    </div>
  {/if}
</div>
