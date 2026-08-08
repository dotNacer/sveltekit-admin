<script lang="ts">
  import StatCard from './StatCard.svelte';
  import ModelCard from './ModelCard.svelte';

  let {
    models,
    stats,
    basePath
  }: {
    models: Array<{ name: string; label: string; count: number }>;
    stats: { total: number; models: number };
    basePath: string;
  } = $props();
</script>

<h1>Dashboard</h1>
<p class="ska-subtitle">Welcome to your admin panel</p>

<div class="ska-stats">
  <StatCard icon="models" value={stats.models} label="Models" />
  <StatCard icon="records" value={stats.total} label="Total Records" />
</div>

<h2>Models</h2>
<div class="ska-models">
  {#each models as m (m.name)}
    <ModelCard href="{basePath}/{m.name.toLowerCase()}" label={m.label} count={m.count} />
  {/each}
</div>
