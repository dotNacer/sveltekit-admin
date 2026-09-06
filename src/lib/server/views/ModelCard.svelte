<script lang="ts">
  let {
    href,
    newHref,
    label,
    count
  }: { href: string; newHref: string; label: string; count: number } = $props();
</script>

<!--
  Deux liens dans une même carte : la carte ne peut donc plus être un <a>
  (un <a> dans un <a> est invalide et casse la navigation clavier). Le lien
  « Manage » reste étendu à toute la surface via ::after (motif stretched
  link), le lien de création passe au-dessus par z-index.
-->
<article class="ska-model-card">
  <div>
    <div class="ska-model-card__name">{label}</div>
    <div class="ska-model-card__count">{count} records</div>
  </div>
  <div class="ska-model-card__footer">
    <a {href} class="ska-model-card__link">Manage →</a>
    <a href={newHref} class="ska-model-card__new" aria-label="New {label}">+ New</a>
  </div>
</article>
