<script lang="ts">
  import type { PrismaField } from '../server/introspection/parser.js';

  interface Column {
    key: string;
    label: string;
    sortable?: boolean;
    type?: string;
    render?: (value: unknown, row: Record<string, unknown>) => string;
  }

  interface Props {
    data: Record<string, unknown>[];
    columns: Column[];
    primaryKey?: string;
    basePath: string;
    modelName: string;
    
    // Pagination
    page?: number;
    perPage?: number;
    total?: number;
    
    // Sorting
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    
    // Search
    searchable?: boolean;
    searchValue?: string;
    
    // Actions
    onDelete?: (id: string | number) => Promise<void>;
  }

  let {
    data = [],
    columns = [],
    primaryKey = 'id',
    basePath,
    modelName,
    page = 1,
    perPage = 20,
    total = 0,
    orderBy = 'id',
    orderDir = 'desc',
    searchable = true,
    searchValue = '',
    onDelete
  }: Props = $props();

  let searchInput = $state(searchValue);
  let deleteConfirm = $state<string | number | null>(null);
  let isDeleting = $state(false);

  const totalPages = $derived(Math.ceil(total / perPage));
  const startItem = $derived((page - 1) * perPage + 1);
  const endItem = $derived(Math.min(page * perPage, total));

  function formatValue(value: unknown, type?: string): string {
    if (value === null || value === undefined) return '—';
    
    if (type === 'datetime' || value instanceof Date) {
      return new Date(value as string).toLocaleString();
    }
    
    if (type === 'boolean' || typeof value === 'boolean') {
      return value ? '✓' : '✗';
    }
    
    if (typeof value === 'object') {
      // Handle relations - show a display field
      const obj = value as Record<string, unknown>;
      return String(obj.name || obj.title || obj.email || obj.id || JSON.stringify(value));
    }
    
    return String(value);
  }

  function getEditUrl(row: Record<string, unknown>): string {
    return `${basePath}/${modelName.toLowerCase()}/${row[primaryKey]}`;
  }

  function handleSearch(e: Event) {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (searchInput) {
      url.searchParams.set('search', searchInput);
    } else {
      url.searchParams.delete('search');
    }
    url.searchParams.set('page', '1');
    window.location.href = url.toString();
  }

  function handleSort(column: Column) {
    if (!column.sortable) return;
    
    const url = new URL(window.location.href);
    const newDir = orderBy === column.key && orderDir === 'asc' ? 'desc' : 'asc';
    url.searchParams.set('orderBy', column.key);
    url.searchParams.set('orderDir', newDir);
    window.location.href = url.toString();
  }

  function goToPage(newPage: number) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(newPage));
    window.location.href = url.toString();
  }

  async function handleDelete(id: string | number) {
    if (!onDelete) return;
    
    isDeleting = true;
    try {
      await onDelete(id);
      deleteConfirm = null;
      window.location.reload();
    } catch (e) {
      alert('Error deleting record');
    } finally {
      isDeleting = false;
    }
  }

  const icons = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
    sortAsc: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`,
    sortDesc: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/></svg>`,
    chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
    chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`
  };
</script>

<div class="ska-table-container">
  <!-- Toolbar -->
  <div class="ska-table-toolbar">
    {#if searchable}
      <form class="ska-search" onsubmit={handleSearch}>
        <span class="ska-search__icon">{@html icons.search}</span>
        <input
          type="text"
          class="ska-search__input"
          placeholder="Search..."
          bind:value={searchInput}
        />
      </form>
    {/if}

    <a href="{basePath}/{modelName.toLowerCase()}/new" class="ska-btn ska-btn--primary">
      + New {modelName}
    </a>
  </div>

  <!-- Table -->
  <div class="ska-table-wrapper">
    <table class="ska-table">
      <thead>
        <tr>
          {#each columns as column}
            <th 
              class:ska-table__th--sortable={column.sortable}
              onclick={() => handleSort(column)}
            >
              <span class="ska-table__th-content">
                {column.label}
                {#if column.sortable && orderBy === column.key}
                  <span class="ska-table__sort-icon">
                    {@html orderDir === 'asc' ? icons.sortAsc : icons.sortDesc}
                  </span>
                {/if}
              </span>
            </th>
          {/each}
          <th class="ska-table__th--actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each data as row}
          <tr>
            {#each columns as column}
              <td>
                {#if column.render}
                  {@html column.render(row[column.key], row)}
                {:else}
                  {formatValue(row[column.key], column.type)}
                {/if}
              </td>
            {/each}
            <td class="ska-table__actions">
              <a href={getEditUrl(row)} class="ska-table__action ska-table__action--edit" title="Edit">
                {@html icons.edit}
              </a>
              {#if onDelete}
                <button 
                  class="ska-table__action ska-table__action--delete" 
                  title="Delete"
                  onclick={() => deleteConfirm = row[primaryKey] as string | number}
                >
                  {@html icons.trash}
                </button>
              {/if}
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan={columns.length + 1} class="ska-table__empty">
              No records found
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="ska-pagination">
      <span class="ska-pagination__info">
        Showing {startItem} to {endItem} of {total} results
      </span>
      
      <div class="ska-pagination__controls">
        <button 
          class="ska-pagination__btn"
          disabled={page <= 1}
          onclick={() => goToPage(page - 1)}
        >
          {@html icons.chevronLeft}
        </button>
        
        {#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          // Show pages around current page
          let p;
          if (totalPages <= 5) {
            p = i + 1;
          } else if (page <= 3) {
            p = i + 1;
          } else if (page >= totalPages - 2) {
            p = totalPages - 4 + i;
          } else {
            p = page - 2 + i;
          }
          return p;
        }) as pageNum}
          <button 
            class="ska-pagination__btn"
            class:ska-pagination__btn--active={pageNum === page}
            onclick={() => goToPage(pageNum)}
          >
            {pageNum}
          </button>
        {/each}
        
        <button 
          class="ska-pagination__btn"
          disabled={page >= totalPages}
          onclick={() => goToPage(page + 1)}
        >
          {@html icons.chevronRight}
        </button>
      </div>
    </div>
  {/if}
</div>

<!-- Delete Confirmation Modal -->
{#if deleteConfirm !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="ska-modal-overlay" role="presentation" onclick={() => deleteConfirm = null}>
    <div class="ska-modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <h3 class="ska-modal__title">Confirm Delete</h3>
      <p class="ska-modal__text">Are you sure you want to delete this record? This action cannot be undone.</p>
      <div class="ska-modal__actions">
        <button class="ska-btn ska-btn--secondary" onclick={() => deleteConfirm = null}>
          Cancel
        </button>
        <button 
          class="ska-btn ska-btn--danger" 
          onclick={() => handleDelete(deleteConfirm!)}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ska-table-container {
    background: white;
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    overflow: hidden;
  }

  .ska-table-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #e2e8f0;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .ska-search {
    position: relative;
    flex: 1;
    max-width: 20rem;
  }

  .ska-search__icon {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: #94a3b8;
    pointer-events: none;
  }

  .ska-search__input {
    width: 100%;
    padding: 0.5rem 0.75rem 0.5rem 2.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .ska-search__input:focus {
    border-color: var(--ska-primary, #6366f1);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  .ska-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .ska-btn--primary {
    background: var(--ska-primary, #6366f1);
    color: white;
  }

  .ska-btn--primary:hover {
    opacity: 0.9;
  }

  .ska-btn--secondary {
    background: #f1f5f9;
    color: #475569;
  }

  .ska-btn--secondary:hover {
    background: #e2e8f0;
  }

  .ska-btn--danger {
    background: #ef4444;
    color: white;
  }

  .ska-btn--danger:hover {
    background: #dc2626;
  }

  .ska-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ska-table-wrapper {
    overflow-x: auto;
  }

  .ska-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .ska-table th {
    text-align: left;
    padding: 0.75rem 1rem;
    background: #f8fafc;
    font-weight: 600;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
  }

  .ska-table__th--sortable {
    cursor: pointer;
    user-select: none;
  }

  .ska-table__th--sortable:hover {
    background: #f1f5f9;
  }

  .ska-table__th-content {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .ska-table__sort-icon {
    color: var(--ska-primary, #6366f1);
  }

  .ska-table__th--actions {
    width: 100px;
    text-align: center;
  }

  .ska-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
  }

  .ska-table tbody tr:hover {
    background: #f8fafc;
  }

  .ska-table__actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .ska-table__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.25rem;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    text-decoration: none;
  }

  .ska-table__action--edit {
    color: #6366f1;
  }

  .ska-table__action--edit:hover {
    background: #eef2ff;
  }

  .ska-table__action--delete {
    color: #ef4444;
  }

  .ska-table__action--delete:hover {
    background: #fef2f2;
  }

  .ska-table__empty {
    text-align: center;
    color: #94a3b8;
    padding: 3rem 1rem !important;
  }

  .ska-pagination {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-top: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .ska-pagination__info {
    font-size: 0.875rem;
    color: #64748b;
  }

  .ska-pagination__controls {
    display: flex;
    gap: 0.25rem;
  }

  .ska-pagination__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.25rem;
    background: white;
    font-size: 0.875rem;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s;
  }

  .ska-pagination__btn:hover:not(:disabled) {
    background: #f8fafc;
    border-color: #cbd5e1;
  }

  .ska-pagination__btn--active {
    background: var(--ska-primary, #6366f1);
    border-color: var(--ska-primary, #6366f1);
    color: white;
  }

  .ska-pagination__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ska-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .ska-modal {
    background: white;
    border-radius: 0.5rem;
    padding: 1.5rem;
    max-width: 24rem;
    width: 90%;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }

  .ska-modal__title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 0.5rem;
  }

  .ska-modal__text {
    color: #64748b;
    font-size: 0.875rem;
    margin: 0 0 1.5rem;
  }

  .ska-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }
</style>
