<script lang="ts">
  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        fields: Array<{ name: string; type: string; required: boolean; label?: string }>;
      };
      config: { basePath: string; readonly?: string[] };
    };
  }

  let { data }: Props = $props();
</script>

<h1>Create {data.model.label || data.model.name}</h1>
<p><a href="{data.config.basePath}/{data.model.name.toLowerCase()}">← Back to list</a></p>

<form method="POST" style="max-width: 600px;">
  {#each data.model.fields as field}
    <div style="margin-bottom: 1rem;">
      <label style="display: block; margin-bottom: 0.25rem; font-weight: 500;">
        {field.label || field.name}
        {#if field.required}<span style="color: red;">*</span>{/if}
      </label>
      
      {#if field.type === 'Boolean'}
        <input type="checkbox" name={field.name} />
      {:else if field.type === 'Int' || field.type === 'Float'}
        <input type="number" name={field.name} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {:else if field.type === 'DateTime'}
        <input type="datetime-local" name={field.name} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {:else}
        <input type="text" name={field.name} required={field.required} style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px;" />
      {/if}
    </div>
  {/each}
  
  <button type="submit" style="background: #6366f1; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; cursor: pointer;">
    Create
  </button>
</form>
