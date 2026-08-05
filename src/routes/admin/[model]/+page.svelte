<script lang="ts">
  import DataTable from '$lib/components/DataTable.svelte';

  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        fields: Array<{
          name: string;
          type: string;
          label?: string;
        }>;
        primaryKey: string;
      };
      items: Record<string, unknown>[];
      total: number;
      page: number;
      perPage: number;
      orderBy: string;
      orderDir: 'asc' | 'desc';
      search: string;
      config: {
        basePath: string;
        hidden?: string[];
        listFields?: string[];
      };
    };
  }

  let { data }: Props = $props();

  // Build columns from model fields
  const columns = $derived(() => {
    const { fields, primaryKey } = data.model;
    const { hidden = [], listFields } = data.config;

    let displayFields = fields.filter(f => !hidden.includes(f.name));
    
    if (listFields && listFields.length > 0) {
      displayFields = displayFields.filter(f => listFields.includes(f.name));
    }

    // Limit to reasonable number of columns
    displayFields = displayFields.slice(0, 6);

    return displayFields.map(f => ({
      key: f.name,
      label: f.label || toLabel(f.name),
      sortable: !f.type.includes('relation'),
      type: mapType(f.type)
    }));
  });

  function toLabel(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').trim();
  }

  function mapType(type: string): string {
    if (type === 'DateTime') return 'datetime';
    if (type === 'Boolean') return 'boolean';
    return 'text';
  }

  async function handleDelete(id: string | number) {
    const response = await fetch(`${data.config.basePath}/${data.model.name.toLowerCase()}/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete');
    }
  }
</script>

<div class="ska-list-page">
  <header class="ska-list-page__header">
    <div>
      <h1 class="ska-list-page__title">{data.model.label || toLabel(data.model.name)}</h1>
      <p class="ska-list-page__subtitle">{data.total} records</p>
    </div>
  </header>

  <DataTable
    data={data.items}
    columns={columns()}
    primaryKey={data.model.primaryKey}
    basePath={data.config.basePath}
    modelName={data.model.name}
    page={data.page}
    perPage={data.perPage}
    total={data.total}
    orderBy={data.orderBy}
    orderDir={data.orderDir}
    searchValue={data.search}
    onDelete={handleDelete}
  />
</div>

<style>
  .ska-list-page__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .ska-list-page__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 0.25rem;
  }

  .ska-list-page__subtitle {
    color: #64748b;
    font-size: 0.875rem;
    margin: 0;
  }
</style>
