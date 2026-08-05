import type { AdminHandlerConfig } from '../handler.js';
import type { PrismaField } from '../introspection/parser.js';
import type { ViewModel } from './types.js';
import { escapeHtml, toLabel } from './html.js';

export function fieldInput(field: PrismaField, value: any, isReadonly: boolean): string {
  const label = toLabel(field.name);
  const required = field.isRequired && !field.hasDefault && !isReadonly;
  
  if (field.type === 'Boolean') {
    return `
      <div class="ska-field">
        <label class="ska-checkbox-wrap">
          <input type="checkbox" name="${field.name}" class="ska-checkbox" ${value ? 'checked' : ''} ${isReadonly ? 'disabled' : ''}>
          <span class="ska-label">${label}</span>
        </label>
      </div>
    `;
  }

  let inputType = 'text';
  let inputValue = value ?? '';
  
  switch (field.type) {
    case 'Int':
    case 'Float':
    case 'Decimal':
    case 'BigInt':
      inputType = 'number';
      break;
    case 'DateTime':
      inputType = 'datetime-local';
      if (value) {
        inputValue = new Date(value).toISOString().slice(0, 16);
      }
      break;
    case 'Json':
      return `
        <div class="ska-field">
          <label class="ska-label">${label}${required ? ' *' : ''}</label>
          <textarea name="${field.name}" class="ska-input" rows="4" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>${value ? escapeHtml(JSON.stringify(value, null, 2)) : ''}</textarea>
        </div>
      `;
  }

  // Handle String fields that might be long
  if (field.type === 'String' && (field.name.includes('description') || field.name.includes('content') || field.name.includes('body'))) {
    return `
      <div class="ska-field">
        <label class="ska-label">${label}${required ? ' *' : ''}</label>
        <textarea name="${field.name}" class="ska-input" rows="4" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>${escapeHtml(String(inputValue))}</textarea>
      </div>
    `;
  }

  return `
    <div class="ska-field">
      <label class="ska-label">${label}${required ? ' *' : ''}</label>
      <input type="${inputType}" name="${field.name}" value="${escapeHtml(String(inputValue))}" class="ska-input" ${isReadonly ? 'readonly' : ''} ${required ? 'required' : ''}>
    </div>
  `;
}

export function createView(
  model: ViewModel,
  basePath: string,
  config: AdminHandlerConfig,
  error?: string
): string {
  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  
  const formFields = model.fields.filter(f => 
    !hidden.includes(f.name) &&
    !f.isId &&
    !f.isCreatedAt &&
    !f.isUpdatedAt &&
    !f.relation &&
    !f.hasDefault
  );

  return `
    <a href="${basePath}/${model.name.toLowerCase()}" class="ska-back">← Back to list</a>
    <h1>Create ${model.label}</h1>
    
    ${error ? `<div class="ska-alert ska-alert--error">${error}</div>` : ''}
    
    <div class="ska-card">
      <form method="POST" class="ska-form">
        <input type="hidden" name="_action" value="create">
        ${formFields.map(f => fieldInput(f, null, false)).join('')}
        <div class="ska-form__actions">
          <button type="submit" class="ska-btn ska-btn--primary">Create</button>
          <a href="${basePath}/${model.name.toLowerCase()}" class="ska-btn ska-btn--secondary">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

export function editView(
  model: ViewModel,
  item: any,
  basePath: string,
  config: AdminHandlerConfig,
  error?: string
): string {
  const modelConfig = config.models?.[model.name] || {};
  const hidden = modelConfig.hidden || [];
  const readonly = modelConfig.readonly || [];
  
  const formFields = model.fields.filter(f => 
    !hidden.includes(f.name) &&
    !f.relation
  );

  const id = item[model.primaryKey];

  return `
    <a href="${basePath}/${model.name.toLowerCase()}" class="ska-back">← Back to list</a>
    <h1>Edit ${model.label}</h1>
    <p class="ska-subtitle">ID: ${escapeHtml(String(id))}</p>
    
    ${error ? `<div class="ska-alert ska-alert--error">${error}</div>` : ''}
    
    <div class="ska-card">
      <form method="POST" class="ska-form">
        <input type="hidden" name="_action" value="update">
        ${formFields.map(f => fieldInput(f, item[f.name], f.isId || f.isCreatedAt || f.isUpdatedAt || readonly.includes(f.name))).join('')}
        <div class="ska-form__actions">
          <button type="submit" class="ska-btn ska-btn--primary">Save Changes</button>
          <a href="${basePath}/${model.name.toLowerCase()}" class="ska-btn ska-btn--secondary">Cancel</a>
        </div>
      </form>
    </div>
  `;
}
