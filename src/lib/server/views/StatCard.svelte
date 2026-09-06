<script lang="ts">
  let {
    value,
    label,
    icon,
    href
  }: {
    value: number;
    label: string;
    icon: 'models' | 'records' | 'filter';
    href?: string;
  } = $props();
</script>

{#snippet body()}
  <div class="ska-stat__icon">
    {#if icon === 'models'}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/></svg>
    {:else if icon === 'records'}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
    {:else}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
    {/if}
  </div>
  <div>
    <div class="ska-stat__value">{value}</div>
    <div class="ska-stat__label">{label}</div>
  </div>
{/snippet}

{#if href}
  <a {href} class="ska-stat ska-stat--link">{@render body()}</a>
{:else}
  <div class="ska-stat">{@render body()}</div>
{/if}
