<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { ViewModel } from './types.js';
  import FieldInput from './FieldInput.svelte';
  import RelationSelect from './RelationSelect.svelte';
  import RelationCheckboxes from './RelationCheckboxes.svelte';
  import RelatedBlock from './RelatedBlock.svelte';

  let {
    mode,
    model,
    basePath,
    config,
    item
  }: {
    mode: 'create' | 'edit';
    model: ViewModel;
    basePath: string;
    config: AdminHandlerConfig;
    item?: any;
  } = $props();

  const modelConfig = $derived(config.models?.[model.name] || {});
  const hidden = $derived(modelConfig.hidden || []);
  const readonly = $derived(modelConfig.readonly || []);
  const listPath = $derived(`${basePath}/${model.name.toLowerCase()}`);

  const formFields = $derived(
    mode === 'create'
      ? model.fields.filter(
          (f) =>
            !hidden.includes(f.name) &&
            !f.isId &&
            !f.isCreatedAt &&
            !f.isUpdatedAt &&
            !f.relation &&
            !f.hasDefault &&
            // Masqué : remplacé par le select de sa relation ci-dessous.
            !model.relationGraph?.scalarToRelation.has(f.name)
        )
      : model.fields.filter(
          (f) =>
            !hidden.includes(f.name) &&
            !f.relation &&
            !model.relationGraph?.scalarToRelation.has(f.name)
        )
  );

  const isFieldReadonly = (f: (typeof formFields)[number]) =>
    mode === 'edit' && (f.isId || f.isCreatedAt || f.isUpdatedAt || readonly.includes(f.name));

  const relationSelects = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) =>
            e.model === model.name &&
            e.kind === 'to-one-owning' &&
            !e.unsupported &&
            !hidden.includes(e.field) &&
            model.relationOptions?.has(`${e.model}.${e.field}`)
        )
      : []
  );

  const currentValueOf = (scalarName: string) => (item ? item[scalarName] : null);

  const relationCheckboxGroups = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) =>
            e.model === model.name &&
            e.kind === 'm2m' &&
            !e.unsupported &&
            !hidden.includes(e.field) &&
            model.relationOptions?.has(`${e.model}.${e.field}`)
        )
      : []
  );

  const inverseEdges = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) => e.model === model.name && (e.kind === 'to-many-inverse' || e.kind === 'to-one-inverse')
        )
      : []
  );
</script>

<a href={listPath} class="ska-back">← Back to list</a>
<h1>{mode === 'create' ? 'Create' : 'Edit'} {model.label}</h1>
{#if mode === 'edit'}
  <p class="ska-subtitle">ID: {item[model.primaryKey]}</p>
{/if}

<div class="ska-card">
  <form method="POST" class="ska-form">
    <input type="hidden" name="_action" value={mode === 'create' ? 'create' : 'update'} />
    {#each formFields as f (f.name)}
      <FieldInput field={f} value={item ? item[f.name] : null} isReadonly={isFieldReadonly(f)} />
    {/each}
    {#each relationSelects as edge (edge.field)}
      <RelationSelect
        {edge}
        meta={model.relationOptions!.get(`${edge.model}.${edge.field}`)!}
        currentValue={currentValueOf(edge.scalarFields[0])}
        {config}
      />
    {/each}
    {#each relationCheckboxGroups as edge (edge.field)}
      <RelationCheckboxes {edge} meta={model.relationOptions!.get(`${edge.model}.${edge.field}`)!} />
    {/each}
    <div class="ska-form__actions">
      <button type="submit" class="ska-btn ska-btn--primary">{mode === 'create' ? 'Create' : 'Save Changes'}</button>
      <a href={listPath} class="ska-btn ska-btn--secondary">Cancel</a>
    </div>
  </form>
</div>
{#if mode === 'edit' && model.relationGraph && model.relatedCounts}
  <RelatedBlock
    edges={inverseEdges}
    graph={model.relationGraph}
    counts={model.relatedCounts}
    currentId={item[model.primaryKey]}
    {basePath}
  />
{/if}

