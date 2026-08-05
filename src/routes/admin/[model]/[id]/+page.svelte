<script lang="ts">
  import AdminForm from '$lib/components/AdminForm.svelte';
  import { goto } from '$app/navigation';

  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        primaryKey: string;
        fields: Array<{
          name: string;
          type: string;
          required: boolean;
          label?: string;
        }>;
      };
      item: Record<string, unknown>;
      config: {
        basePath: string;
        hidden?: string[];
        readonly?: string[];
      };
      relationOptions?: Record<string, Array<{ id: string | number; label: string }>>;
    };
  }

  let { data }: Props = $props();

  function toLabel(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').trim();
  }

  function mapType(type: string): string {
    switch (type) {
      case 'String': return 'text';
      case 'Int':
      case 'Float':
      case 'Decimal':
      case 'BigInt': return 'number';
      case 'Boolean': return 'checkbox';
      case 'DateTime': return 'datetime';
      case 'Json': return 'json';
      default: return 'text';
    }
  }

  const formFields = $derived(() => {
    const { fields, primaryKey } = data.model;
    const { hidden = [], readonly = [] } = data.config;

    return fields
      .filter(f => !hidden.includes(f.name))
      .map(f => ({
        name: f.name,
        type: mapType(f.type),
        label: f.label || toLabel(f.name),
        required: f.required,
        readonly: readonly.includes(f.name) || f.name === primaryKey || /^(createdAt|updatedAt)$/i.test(f.name),
        relationOptions: data.relationOptions?.[f.name]
      }));
  });

  const itemId = $derived(data.item[data.model.primaryKey]);

  async function handleSubmit(formData: Record<string, unknown>) {
    const response = await fetch(`${data.config.basePath}/${data.model.name.toLowerCase()}/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw error;
    }

    goto(`${data.config.basePath}/${data.model.name.toLowerCase()}`);
  }
</script>

<div class="ska-edit-page">
  <header class="ska-edit-page__header">
    <a href="{data.config.basePath}/{data.model.name.toLowerCase()}" class="ska-edit-page__back">
      ← Back to list
    </a>
    <h1 class="ska-edit-page__title">Edit {data.model.label || toLabel(data.model.name)}</h1>
    <p class="ska-edit-page__id">ID: {itemId}</p>
  </header>

  <AdminForm
    fields={formFields()}
    values={data.item}
    action="{data.config.basePath}/{data.model.name.toLowerCase()}/{itemId}"
    method="POST"
    submitLabel="Update"
    cancelHref="{data.config.basePath}/{data.model.name.toLowerCase()}"
    onSubmit={handleSubmit}
  />
</div>

<style>
  .ska-edit-page {
    max-width: 800px;
  }

  .ska-edit-page__header {
    margin-bottom: 1.5rem;
  }

  .ska-edit-page__back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: #64748b;
    text-decoration: none;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .ska-edit-page__back:hover {
    color: #475569;
  }

  .ska-edit-page__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0;
  }

  .ska-edit-page__id {
    color: #94a3b8;
    font-size: 0.875rem;
    margin: 0.25rem 0 0;
    font-family: ui-monospace, monospace;
  }
</style>
