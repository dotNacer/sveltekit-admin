<script lang="ts">
  import type { RelationEdge } from '../introspection/relations.js';
  import type { RelationMeta } from './types.js';
  import { toLabel } from './html.js';

  let {
    edge,
    meta
  }: {
    edge: RelationEdge;
    meta: RelationMeta;
  } = $props();

  const label = $derived(toLabel(edge.field));
  const inputName = $derived(`__rel__${edge.field}`);
  const selected = $derived(new Set((meta.selectedIds ?? []).map(String)));
</script>

<!--
  Fieldset de checkboxes pour une arête m2m.

  Nommage `__rel__<field>` pour les valeurs cochées et un hidden sentinelle
  `__rel_present__<field>` toujours émis : en HTML, zéro checkbox cochée
  retire la clé du POST, donc impossible de distinguer "tout décoché" de
  "widget absent" sans ce sentinelle. Voir docs/design/relations.md §3.1.
-->
{#if meta.tooMany}
  <!-- Au-delà du seuil : liste d'IDs texte, jamais des centaines de checkboxes. -->
  <div class="ska-field">
    <label class="ska-label" for={inputName}>{label} (IDs séparés par des virgules)</label>
    <input type="hidden" name="__rel_present__{edge.field}" value="1" />
    <input id={inputName} type="text" name={inputName} value={[...selected].join(',')} class="ska-input" />
  </div>
{:else}
  <div class="ska-field">
    <label class="ska-label" for={inputName}>{label}</label>
    <input type="hidden" name="__rel_present__{edge.field}" value="1" />
    <fieldset id={inputName} class="ska-checkbox-group">
      {#each meta.options as opt (opt.id)}
        <label class="ska-checkbox-wrap">
          <input
            type="checkbox"
            name={inputName}
            value={opt.id}
            class="ska-checkbox"
            checked={selected.has(String(opt.id))}
          />
          <span class="ska-label">{opt.label}</span>
        </label>
      {/each}
    </fieldset>
  </div>
{/if}
