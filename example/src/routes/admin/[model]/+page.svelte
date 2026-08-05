<script lang="ts">
  interface Props {
    data: {
      model: {
        name: string;
        label?: string;
        fields: Array<{ name: string; type: string; label?: string }>;
        primaryKey: string;
      };
      items: Record<string, unknown>[];
      total: number;
      page: number;
      perPage: number;
      config: { basePath: string };
    };
  }

  let { data }: Props = $props();
</script>

<h1>{data.model.label || data.model.name}</h1>
<p>{data.total} records</p>
<p><a href="{data.config.basePath}/{data.model.name.toLowerCase()}/new">+ New</a></p>

<table style="width: 100%; border-collapse: collapse;">
  <thead>
    <tr style="background: #f1f5f9;">
      {#each data.model.fields as field}
        <th style="text-align: left; padding: 0.5rem; border: 1px solid #e2e8f0;">{field.label || field.name}</th>
      {/each}
      <th style="padding: 0.5rem; border: 1px solid #e2e8f0;">Actions</th>
    </tr>
  </thead>
  <tbody>
    {#each data.items as item}
      <tr>
        {#each data.model.fields as field}
          <td style="padding: 0.5rem; border: 1px solid #e2e8f0;">
            {#if typeof item[field.name] === 'object' && item[field.name] !== null}
              {JSON.stringify(item[field.name])}
            {:else if item[field.name] instanceof Date}
              {new Date(item[field.name] as string).toLocaleDateString()}
            {:else}
              {item[field.name] ?? '—'}
            {/if}
          </td>
        {/each}
        <td style="padding: 0.5rem; border: 1px solid #e2e8f0;">
          <a href="{data.config.basePath}/{data.model.name.toLowerCase()}/{item[data.model.primaryKey]}">Edit</a>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
