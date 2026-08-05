<script lang="ts">
  interface Props {
    data: {
      models: Array<{ name: string; label?: string; count: number }>;
      stats: { totalRecords: number; modelsCount: number };
    };
  }

  let { data }: Props = $props();
</script>

<h1>Dashboard</h1>
<p>Models: {data.stats.modelsCount} | Total records: {data.stats.totalRecords}</p>

<ul>
{#each data.models as model}
  <li>
    <a href="/admin/{model.name.toLowerCase()}">{model.label || model.name}</a>
    ({model.count} records)
  </li>
{/each}
</ul>
