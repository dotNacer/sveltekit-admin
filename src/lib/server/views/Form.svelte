<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { ViewModel } from './types.js';
  import FieldInput from './FieldInput.svelte';

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

  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  const readonly = modelConfig.readonly || [];
  const listPath = `${basePath}/${model.name.toLowerCase()}`;

  const formFields = $derived(
    mode === 'create'
      ? model.fields.filter(
          (f) => !hidden.includes(f.name) && !f.isId && !f.isCreatedAt && !f.isUpdatedAt && !f.relation && !f.hasDefault
        )
      : model.fields.filter((f) => !hidden.includes(f.name) && !f.relation)
  );

  const isFieldReadonly = (f: (typeof formFields)[number]) =>
    mode === 'edit' && (f.isId || f.isCreatedAt || f.isUpdatedAt || readonly.includes(f.name));
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
    <div class="ska-form__actions">
      <button type="submit" class="ska-btn ska-btn--primary">{mode === 'create' ? 'Create' : 'Save Changes'}</button>
      <a href={listPath} class="ska-btn ska-btn--secondary">Cancel</a>
    </div>
  </form>
</div>
