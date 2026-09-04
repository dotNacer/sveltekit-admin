<script lang="ts">
  import type { RecentItem } from '../dashboard.js';

  let {
    title,
    href,
    items
  }: { title: string; href: string; items: RecentItem[] } = $props();
</script>

<section class="ska-dashboard__section">
  <h2>{title}</h2>
  {#if items.length === 0}
    <p class="ska-subtitle">No records yet</p>
  {:else}
    <ul class="ska-recent">
      {#each items as item (item.href)}
        <li class="ska-recent__item">
          <a href={item.href}>{item.label}</a>
        </li>
      {/each}
    </ul>
  {/if}
  <a class="ska-recent__all" {href}>View all →</a>
</section>
