<script lang="ts">
  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        primaryKey: string;
        fields: Array<{ name: string; type: string; required: boolean; label?: string }>;
      };
      item: Record<string, unknown>;
      config: { basePath: string; readonly?: string[] };
    };
  }

  let { data }: Props = $props();
  
  function formatValue(value: unknown, type: string): string {
    if (value === null || value === undefined) return '';
    if (type === 'DateTime' && value) {
      const d = new Date(value as string);
      return d.toISOString().slice(0, 16);
    }
    return String(value);
  }
</script>

<h1>Edit {data.model.label || data.model.name}</h1>
<p>ID: {data.item[data.model.primaryKey]}</p>
<p><a href="{data.config.basePath}/{data.model.name.toLowerCase()}">← Back to list</a></p>

<form method="POST" style="max-width: 600px;">
  {#each data.model.fields as field}
    {@const isReadonly = data.config.readonly?.includes(field.name) || field.name === data.model.primaryKey || /^(createdAt|updatedAt)$/i.test(field.name)}
    <div style="margin-bottom: 1rem;">
      <label style="display: block; margin-bottom: 0.25rem; font-weight: 500;">
        {field.label || field.name}
        {#if field.required && !isReadonly}<span style="color: red;">*</span>{/if}
      </label>
      
      {#if isReadonly}
        <div style="padding: 0.5rem; background: #f5f5f5; border-radius: 4px; color: #666;">
          {formatValue(data.item[field.name], field.type)}
        </div>
      {:else if field.type === 'Boolean'}
        <input type="checkbox" name={field.name} checked={Boolean(data.item[field.name])} />
      {:else if field.type === 'Int' || field.type === 'Float'}
        <input type="number" name={field.name} value={formatValue(data.item[field.name], field.type)} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {:else if field.type === 'DateTime'}
        <input type="datetime-local" name={field.name} value={formatValue(data.item[field.name], field.type)} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {:else}
        <input type="text" name={field.name} value={formatValue(data.item[field.name], field.type)} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {/if}
    </div>
  {/each}
  
  <button type="submit" style="background: #6366f1; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; cursor: pointer;">
    Update
  </button>
</form>
