<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { ViewModel } from './types.js';
  import { getDisplayFields } from '../introspection/parser.js';
  import { escapeHtml, toLabel, formatValue } from './html.js';

  let {
    model,
    items,
    pagination,
    basePath,
    config
  }: {
    model: ViewModel;
    items: any[];
    pagination: { page: number; perPage: number; total: number };
    basePath: string;
    config: AdminHandlerConfig;
  } = $props();

  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  const listFields = modelConfig.listFields;

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

  const listPath = `${basePath}/${model.name.toLowerCase()}`;
  const totalPages = $derived(Math.ceil(pagination.total / pagination.perPage));
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
          <tr><td colspan={displayFields.length + 1} style="text-align: center; color: #64748b; padding: 2rem;">No records found</td></tr>
        {:else}
          {#each items as item (item[model.primaryKey])}
            <tr>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- formatValue already escapes string values itself and returns a literal <span> only for null/undefined -->
              {#each displayFields as f (f.name)}<td>{@html formatValue(item[f.name], f.type)}</td>{/each}
              <td class="ska-table__actions">
                <a href="{listPath}/{item[model.primaryKey]}" class="ska-btn ska-btn--secondary ska-btn--sm">Edit</a>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- Svelte 5 rejects a literal onsubmit string as an event attribute; the PK is escaped manually here since it can't go through Svelte's native attribute escaping -->
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
      {#if pagination.page > 1}<a href="?page={pagination.page - 1}" class="ska-btn ska-btn--secondary ska-btn--sm">Previous</a>{/if}
      {#if pagination.page < totalPages}<a href="?page={pagination.page + 1}" class="ska-btn ska-btn--secondary ska-btn--sm">Next</a>{/if}
    </div>
  {/if}
</div>
