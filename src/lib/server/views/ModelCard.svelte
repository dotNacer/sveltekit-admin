<script lang="ts">
  let { href, label, count }: { href: string; label: string; count: number } = $props();
</script>

<a {href} class="ska-model-card">
  <div>
    <div class="ska-model-card__name">{label}</div>
    <div class="ska-model-card__count">{count} records</div>
  </div>
  <div class="ska-model-card__footer">Manage →</div>
</a>
