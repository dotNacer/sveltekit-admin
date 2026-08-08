<script lang="ts">
  import type { PrismaField } from '../introspection/parser.js';
  import { toLabel } from './html.js';

  let { field, value, isReadonly }: { field: PrismaField; value: any; isReadonly: boolean } =
    $props();

  const label = toLabel(field.name);
  const required = $derived(field.isRequired && !field.hasDefault && !isReadonly);

  const lower = field.name.toLowerCase();
  const isLongText =
    field.type === 'String' &&
    ['description', 'content', 'body', 'bio'].some((k) => lower.includes(k));

  const inputType = $derived.by(() => {
    switch (field.type) {
      case 'Int':
      case 'Float':
      case 'Decimal':
      case 'BigInt':
        return 'number';
      case 'DateTime':
        return 'datetime-local';
      default:
        return 'text';
    }
  });

  const inputValue = $derived.by(() => {
    if (field.type === 'DateTime' && value) {
      return new Date(value).toISOString().slice(0, 16);
    }
    return value ?? '';
  });

  const jsonValue = $derived(value ? JSON.stringify(value, null, 2) : '');
</script>

{#if field.type === 'Boolean'}
  <div class="ska-field">
    <label class="ska-checkbox-wrap">
      <input type="checkbox" name={field.name} class="ska-checkbox" checked={!!value} disabled={isReadonly} />
      <span class="ska-label">{label}</span>
    </label>
  </div>
{:else if field.type === 'Json'}
  <div class="ska-field">
    <label class="ska-label">{label}{required ? ' *' : ''}</label>
    <textarea name={field.name} class="ska-input" rows="4" readonly={isReadonly} required={required}>{jsonValue}</textarea>
  </div>
{:else if isLongText}
  <div class="ska-field">
    <label class="ska-label">{label}{required ? ' *' : ''}</label>
    <textarea name={field.name} class="ska-input" rows="4" readonly={isReadonly} required={required}>{inputValue}</textarea>
  </div>
{:else}
  <div class="ska-field">
    <label class="ska-label">{label}{required ? ' *' : ''}</label>
    <input type={inputType} name={field.name} value={inputValue} class="ska-input" readonly={isReadonly} required={required} />
  </div>
{/if}
