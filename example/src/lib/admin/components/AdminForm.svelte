<script lang="ts">
  import type { PrismaField } from '../server/introspection/parser.js';
  import { getInputType, fieldToLabel } from '../server/introspection/parser.js';

  interface FieldConfig {
    name: string;
    type: string;
    label?: string;
    required?: boolean;
    readonly?: boolean;
    hidden?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
    relationOptions?: { id: string | number; label: string }[];
  }

  interface Props {
    fields: FieldConfig[];
    values?: Record<string, unknown>;
    action: string;
    method?: 'GET' | 'POST';
    submitLabel?: string;
    cancelHref?: string;
    errors?: Record<string, string>;
    onSubmit?: (data: Record<string, unknown>) => Promise<void>;
  }

  let {
    fields = [],
    values = {},
    action,
    method = 'POST',
    submitLabel = 'Save',
    cancelHref,
    errors = {},
    onSubmit
  }: Props = $props();

  let formValues = $state<Record<string, unknown>>({ ...values });
  let isSubmitting = $state(false);
  let formErrors = $state<Record<string, string>>({ ...errors });

  function getFieldValue(name: string): unknown {
    return formValues[name] ?? values[name] ?? '';
  }

  function setFieldValue(name: string, value: unknown) {
    formValues[name] = value;
    // Clear error when user types
    if (formErrors[name]) {
      delete formErrors[name];
    }
  }

  async function handleSubmit(e: Event) {
    if (!onSubmit) return;
    
    e.preventDefault();
    isSubmitting = true;
    formErrors = {};

    try {
      await onSubmit(formValues);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'fieldErrors' in err) {
        formErrors = err.fieldErrors as Record<string, string>;
      } else {
        formErrors = { _form: err instanceof Error ? err.message : 'An error occurred' };
      }
    } finally {
      isSubmitting = false;
    }
  }

  function formatDateTimeLocal(value: unknown): string {
    if (!value) return '';
    const date = new Date(value as string);
    return date.toISOString().slice(0, 16);
  }

  const icons = {
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`
  };
</script>

<form 
  class="ska-form"
  {action} 
  {method}
  onsubmit={onSubmit ? handleSubmit : undefined}
>
  {#if formErrors._form}
    <div class="ska-form__error-banner">
      {formErrors._form}
    </div>
  {/if}

  <div class="ska-form__fields">
    {#each fields.filter(f => !f.hidden) as field}
      <div class="ska-form__group" class:ska-form__group--error={formErrors[field.name]}>
        <label class="ska-form__label" for={field.name}>
          {field.label || fieldToLabel(field.name)}
          {#if field.required}
            <span class="ska-form__required">*</span>
          {/if}
        </label>

        {#if field.readonly}
          <div class="ska-form__static">
            {getFieldValue(field.name) || '—'}
          </div>
        {:else if field.type === 'textarea'}
          <textarea
            id={field.name}
            name={field.name}
            class="ska-form__input ska-form__textarea"
            placeholder={field.placeholder}
            required={field.required}
            value={String(getFieldValue(field.name) || '')}
            oninput={(e) => setFieldValue(field.name, e.currentTarget.value)}
          ></textarea>
        {:else if field.type === 'checkbox'}
          <label class="ska-form__checkbox">
            <input
              type="checkbox"
              id={field.name}
              name={field.name}
              checked={Boolean(getFieldValue(field.name))}
              onchange={(e) => setFieldValue(field.name, e.currentTarget.checked)}
            />
            <span class="ska-form__checkbox-mark"></span>
            <span class="ska-form__checkbox-label">Enabled</span>
          </label>
        {:else if field.type === 'select' || field.options}
          <select
            id={field.name}
            name={field.name}
            class="ska-form__input ska-form__select"
            required={field.required}
            value={String(getFieldValue(field.name) || '')}
            onchange={(e) => setFieldValue(field.name, e.currentTarget.value)}
          >
            <option value="">Select...</option>
            {#each field.options || [] as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        {:else if field.type === 'relation' && field.relationOptions}
          <select
            id={field.name}
            name={field.name}
            class="ska-form__input ska-form__select"
            required={field.required}
            value={String(getFieldValue(field.name) || '')}
            onchange={(e) => setFieldValue(field.name, e.currentTarget.value)}
          >
            <option value="">Select...</option>
            {#each field.relationOptions as option}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        {:else if field.type === 'datetime'}
          <input
            type="datetime-local"
            id={field.name}
            name={field.name}
            class="ska-form__input"
            required={field.required}
            value={formatDateTimeLocal(getFieldValue(field.name))}
            onchange={(e) => setFieldValue(field.name, e.currentTarget.value)}
          />
        {:else if field.type === 'number'}
          <input
            type="number"
            id={field.name}
            name={field.name}
            class="ska-form__input"
            placeholder={field.placeholder}
            required={field.required}
            value={String(getFieldValue(field.name) || '')}
            oninput={(e) => setFieldValue(field.name, e.currentTarget.value)}
          />
        {:else if field.type === 'json'}
          <textarea
            id={field.name}
            name={field.name}
            class="ska-form__input ska-form__textarea ska-form__json"
            placeholder={'{"key": "value"}'}
            required={field.required}
            value={typeof getFieldValue(field.name) === 'object' 
              ? JSON.stringify(getFieldValue(field.name), null, 2) 
              : String(getFieldValue(field.name) || '')}
            oninput={(e) => setFieldValue(field.name, e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            type={field.type === 'email' ? 'email' : field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
            id={field.name}
            name={field.name}
            class="ska-form__input"
            placeholder={field.placeholder}
            required={field.required}
            value={String(getFieldValue(field.name) || '')}
            oninput={(e) => setFieldValue(field.name, e.currentTarget.value)}
          />
        {/if}

        {#if formErrors[field.name]}
          <span class="ska-form__error">{formErrors[field.name]}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="ska-form__actions">
    {#if cancelHref}
      <a href={cancelHref} class="ska-btn ska-btn--secondary">Cancel</a>
    {/if}
    <button type="submit" class="ska-btn ska-btn--primary" disabled={isSubmitting}>
      {isSubmitting ? 'Saving...' : submitLabel}
    </button>
  </div>
</form>

<style>
  .ska-form {
    background: white;
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    padding: 1.5rem;
  }

  .ska-form__error-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  .ska-form__fields {
    display: grid;
    gap: 1.25rem;
  }

  .ska-form__group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .ska-form__group--error .ska-form__input {
    border-color: #ef4444;
  }

  .ska-form__label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  .ska-form__required {
    color: #ef4444;
    margin-left: 0.125rem;
  }

  .ska-form__input {
    padding: 0.625rem 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    background: white;
    color: #1e293b;
  }

  .ska-form__input:focus {
    border-color: var(--ska-primary, #6366f1);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  .ska-form__input::placeholder {
    color: #94a3b8;
  }

  .ska-form__textarea {
    min-height: 6rem;
    resize: vertical;
    font-family: inherit;
  }

  .ska-form__json {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
  }

  .ska-form__select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    padding-right: 2.5rem;
  }

  .ska-form__static {
    padding: 0.625rem 0;
    font-size: 0.875rem;
    color: #64748b;
  }

  .ska-form__checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    user-select: none;
  }

  .ska-form__checkbox input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .ska-form__checkbox-mark {
    width: 1.25rem;
    height: 1.25rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .ska-form__checkbox input:checked + .ska-form__checkbox-mark {
    background: var(--ska-primary, #6366f1);
    border-color: var(--ska-primary, #6366f1);
  }

  .ska-form__checkbox input:checked + .ska-form__checkbox-mark::after {
    content: '';
    width: 0.5rem;
    height: 0.5rem;
    background: white;
    border-radius: 0.125rem;
  }

  .ska-form__checkbox input:focus + .ska-form__checkbox-mark {
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  .ska-form__checkbox-label {
    font-size: 0.875rem;
    color: #475569;
  }

  .ska-form__error {
    font-size: 0.75rem;
    color: #ef4444;
  }

  .ska-form__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #e2e8f0;
  }

  .ska-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .ska-btn--primary {
    background: var(--ska-primary, #6366f1);
    color: white;
  }

  .ska-btn--primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .ska-btn--secondary {
    background: #f1f5f9;
    color: #475569;
  }

  .ska-btn--secondary:hover {
    background: #e2e8f0;
  }

  .ska-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (min-width: 640px) {
    .ska-form__fields {
      grid-template-columns: repeat(2, 1fr);
    }

    .ska-form__group:has(.ska-form__textarea) {
      grid-column: span 2;
    }
  }
</style>
