<script lang="ts">
  import AdminForm from '$lib/components/AdminForm.svelte';
  import { goto } from '$app/navigation';

  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        fields: Array<{
          name: string;
          type: string;
          required: boolean;
          label?: string;
        }>;
      };
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
    const { fields } = data.model;
    const { hidden = [], readonly = [] } = data.config;

    return fields
      .filter(f => !hidden.includes(f.name))
      .filter(f => !f.name.match(/^(id|createdAt|updatedAt)$/i))
      .map(f => ({
        name: f.name,
        type: mapType(f.type),
        label: f.label || toLabel(f.name),
        required: f.required,
        readonly: readonly.includes(f.name),
        relationOptions: data.relationOptions?.[f.name]
      }));
  });

  async function handleSubmit(formData: Record<string, unknown>) {
    const response = await fetch(`${data.config.basePath}/${data.model.name.toLowerCase()}/new`, {
      method: 'POST',
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

<div class="ska-create-page">
  <header class="ska-create-page__header">
    <a href="{data.config.basePath}/{data.model.name.toLowerCase()}" class="ska-create-page__back">
      ← Back to list
    </a>
    <h1 class="ska-create-page__title">Create {data.model.label || toLabel(data.model.name)}</h1>
  </header>

  <AdminForm
    fields={formFields()}
    action="{data.config.basePath}/{data.model.name.toLowerCase()}/new"
    submitLabel="Create"
    cancelHref="{data.config.basePath}/{data.model.name.toLowerCase()}"
    onSubmit={handleSubmit}
  />
</div>

<style>
  .ska-create-page {
    max-width: 800px;
  }

  .ska-create-page__header {
    margin-bottom: 1.5rem;
  }

  .ska-create-page__back {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: #64748b;
    text-decoration: none;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .ska-create-page__back:hover {
    color: #475569;
  }

  .ska-create-page__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0;
  }
</style>
