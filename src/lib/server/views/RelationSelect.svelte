<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { RelationEdge } from '../introspection/relations.js';
  import type { RelationMeta } from './types.js';
  import { toLabel } from './html.js';

  let {
    edge,
    meta,
    currentValue,
    config
  }: {
    edge: RelationEdge;
    meta: RelationMeta;
    currentValue: unknown;
    config: AdminHandlerConfig;
  } = $props();

  const relConfig = $derived(config.models?.[edge.model]?.relations?.[edge.field]);
  const label = $derived(toLabel(edge.field));
  const required = $derived(edge.isRequired);
  const nullLabel = $derived(relConfig?.nullLabel ?? '— aucun —');
  // Toujours défini pour une arête to-one-owning : c'est ce qui la distingue
  // des autres kinds dans le graphe (voir buildRelationGraph).
  const scalarName = $derived(edge.scalarFields[0]);
</script>

{#if meta.tooMany}
  <!-- Au-delà du seuil : raw-id, jamais un select de 10k lignes. -->
  <div class="ska-field">
    <label class="ska-label" for={scalarName}>{label} (ID){required ? ' *' : ''}</label>
    <input
      id={scalarName}
      type="text"
      name={scalarName}
      value={currentValue ?? ''}
      class="ska-input"
      required={required}
    />
  </div>
{:else}
  <div class="ska-field">
    <label class="ska-label" for={scalarName}>{label}{required ? ' *' : ''}</label>
    <select id={scalarName} name={scalarName} class="ska-input" required={required}>
      {#if !required}
        <option value="">{nullLabel}</option>
      {/if}
      {#each meta.options as opt (opt.id)}
        <option value={opt.id} selected={String(opt.id) === String(currentValue ?? '')}>{opt.label}</option>
      {/each}
    </select>
  </div>
{/if}
