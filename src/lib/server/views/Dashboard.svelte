<script lang="ts">
  import StatCard from './StatCard.svelte';
  import ModelCard from './ModelCard.svelte';
  import type { DashboardRow } from '../dashboard.js';

  let {
    title,
    subtitle,
    rows
  }: { title: string; subtitle: string; rows: DashboardRow[] } = $props();
</script>

<header class="ska-dashboard__header">
  <h1>{title}</h1>
  <p class="ska-subtitle">{subtitle}</p>
</header>

{#each rows as row, rowIndex (rowIndex)}
  {#if row.kind === 'cards'}
    <div class="ska-stats">
      {#each row.cards as card, cardIndex (cardIndex)}
        <StatCard value={card.value} label={card.label} icon={card.icon} />
      {/each}
    </div>
  {:else}
    <section class="ska-dashboard__section">
      {#if row.title}<h2>{row.title}</h2>{/if}
      <div class="ska-models">
        {#each row.cards as m (m.name)}
          <ModelCard href={m.href} newHref={m.newHref} label={m.label} count={m.count} />
        {/each}
      </div>
    </section>
  {/if}
{/each}
