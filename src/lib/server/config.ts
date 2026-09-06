import type { Model } from './types/schema.js';
import type { DashboardConfig } from './dashboard.js';
import { toLabel } from './views/html.js';
import { AdminConfigError } from './errors.js';

/** Configuration shared by model presentation, ordering, and navigation. */
export interface ModelConfig {
  hidden?: string[];
  readonly?: string[];
  listFields?: string[];
  label?: string;
  singularLabel?: string;
  pluralLabel?: string;
  fieldOrder?: readonly string[];
  [key: string]: unknown;
}

export interface NavigationCategoryConfig {
  label: string;
  models: readonly string[];
}

export interface NavigationConfig {
  categories?: NavigationCategoryConfig[];
}

export interface NormalizedModelConfig {
  name: string;
  label: string;
  singularLabel: string;
  pluralLabel: string;
  fields: Model['fields'];
}

export interface NormalizedModelNavigationGroup {
  label: string;
  models: Array<{ name: string; label: string }>;
}

export interface NormalizedAdminConfig {
  models: Model[];
  modelList: Array<{ name: string; label: string }>;
  modelGroups?: NormalizedModelNavigationGroup[];
  viewModels: Map<string, NormalizedModelConfig>;
}

const defaultLabel = (model: Model) => {
  const label = toLabel(model.name);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

function ordered<T extends { name: string }>(items: T[], order: readonly string[] | undefined): T[] {
  if (!order) return items;
  const byName = new Map(items.map((item) => [item.name, item]));
  const seen = new Set<string>();
  for (const name of order) {
    if (seen.has(name)) {
      throw new AdminConfigError(`[sveltekit-admin] modelOrder contains duplicate "${name}".`);
    }
    seen.add(name);
    if (!byName.has(name)) {
      throw new AdminConfigError(`[sveltekit-admin] modelOrder contains unknown model "${name}".`);
    }
  }
  return [...order.map((name) => byName.get(name)!), ...items.filter((item) => !seen.has(item.name))];
}

function validateConfiguredFields(model: Model, config: ModelConfig | undefined): void {
  if (!config) return;
  const fields = new Set(model.fields.map((field) => field.name));
  for (const [option, names] of [
    ['hidden', config.hidden],
    ['readonly', config.readonly],
    ['listFields', config.listFields],
    ['fieldOrder', config.fieldOrder]
  ] as const) {
    if (!names) continue;
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) {
        throw new AdminConfigError(
          `[sveltekit-admin] models.${model.name}.${option} contains duplicate "${name}".`
        );
      }
      seen.add(name);
      if (!fields.has(name)) {
        throw new AdminConfigError(
          `[sveltekit-admin] models.${model.name}.${option} contains unknown field "${name}".`
        );
      }
    }
  }
}

function normalizeModel(model: Model, config: ModelConfig | undefined): NormalizedModelConfig {
  const fallback = defaultLabel(model);
  const legacy = config?.label || fallback;
  const singularLabel = config?.singularLabel || legacy;
  const pluralLabel = config?.pluralLabel || legacy;
  const fieldOrder = config?.fieldOrder;
  const fields = fieldOrder
    ? [...fieldOrder.map((name) => model.fields.find((field) => field.name === name)!), ...model.fields.filter((field) => !fieldOrder.includes(field.name))]
    : model.fields;
  return { name: model.name, label: pluralLabel, singularLabel, pluralLabel, fields };
}

/**
 * Resolves model presentation and navigation once at runtime boot. All views
 * consume this normalized result, so labels/order/category semantics cannot
 * diverge between the sidebar, list, and forms.
 */
export function normalizeAdminConfiguration(
  models: Model[],
  modelConfigs: Record<string, ModelConfig> = {},
  modelOrder?: readonly string[],
  navigation?: NavigationConfig
): NormalizedAdminConfig {
  const orderedModels = ordered(models, modelOrder);
  const knownModels = new Set(orderedModels.map((model) => model.name));
  for (const name of Object.keys(modelConfigs)) {
    if (!knownModels.has(name)) {
      throw new AdminConfigError(`[sveltekit-admin] models contains unknown model "${name}".`);
    }
  }
  for (const model of orderedModels) validateConfiguredFields(model, modelConfigs[model.name]);

  const normalized = new Map(
    orderedModels.map((model) => [model.name, normalizeModel(model, modelConfigs[model.name])])
  );
  const modelList = orderedModels.map((model) => {
    const config = normalized.get(model.name)!;
    return { name: model.name, label: config.pluralLabel };
  });

  let modelGroups: NormalizedModelNavigationGroup[] | undefined;
  const categories = navigation?.categories;
  if (categories) {
    const assigned = new Set<string>();
    const labels = new Set<string>();
    modelGroups = categories.map((category) => {
      if (!category.label.trim()) {
        throw new AdminConfigError('[sveltekit-admin] navigation category labels must not be empty.');
      }
      const labelKey = category.label.toLowerCase();
      if (labels.has(labelKey)) {
        throw new AdminConfigError(`[sveltekit-admin] navigation category label "${category.label}" is duplicated.`);
      }
      labels.add(labelKey);
      if (category.models.length === 0) {
        throw new AdminConfigError(`[sveltekit-admin] navigation category "${category.label}" must contain at least one model.`);
      }
      const categoryModels = category.models.map((name) => {
        const model = orderedModels.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
        if (!model) {
          throw new AdminConfigError(`[sveltekit-admin] navigation category "${category.label}" references unknown model "${name}".`);
        }
        const key = model.name.toLowerCase();
        if (assigned.has(key)) {
          throw new AdminConfigError(`[sveltekit-admin] navigation model "${name}" is assigned to more than one category.`);
        }
        assigned.add(key);
        const config = normalized.get(model.name)!;
        return { name: model.name, label: config.pluralLabel };
      });
      return { label: category.label, models: categoryModels };
    });
    const uncategorized = modelList.filter((model) => !assigned.has(model.name.toLowerCase()));
    modelList.splice(0, modelList.length, ...uncategorized);
  }

  return {
    models: orderedModels,
    modelList,
    modelGroups,
    viewModels: normalized
  };
}

/** A map from model names to the union of their field names. */
export type ModelFieldMap = Record<string, string>;

type ModelName<Models extends ModelFieldMap> = keyof Models & string;

export type TypedDashboardWidget<Models extends ModelFieldMap> =
  | { type: 'stats' }
  | { type: 'models'; title?: string; models?: readonly ModelName<Models>[] }
  | { type: 'count'; model: ModelName<Models>; label: string; query?: string }
  | {
      type: 'recent';
      model: ModelName<Models>;
      title?: string;
      limit?: number;
      sort?: string;
      dir?: 'asc' | 'desc';
    };

export type TypedDashboardConfig<Models extends ModelFieldMap> = Omit<DashboardConfig, 'widgets'> & {
  widgets?: TypedDashboardWidget<Models>[];
};

type TypedModelConfig<Fields extends string> = Omit<
  ModelConfig,
  'hidden' | 'readonly' | 'listFields' | 'fieldOrder'
> & {
  hidden?: Fields[];
  readonly?: Fields[];
  listFields?: Fields[];
  fieldOrder?: readonly Fields[];
};

/** Keeps every configured field name narrow for IDE/lint feedback. */
export function defineModelConfig<Fields extends string = string>(
  config: TypedModelConfig<Fields>
): TypedModelConfig<Fields> {
  return config;
}

/**
 * Type-safe authoring helper.
 *
 * Example:
 * `defineAdminConfig<{ User: 'id' | 'email' | 'password' }>({
 *   models: { User: { hidden: ['password'], readonly: ['id'] } }
 * })`
 *
 * A generated map can replace the manual one. Runtime validation remains
 * mandatory because adapters may introspect a different or dynamic schema.
 */
export function defineAdminConfig<Models extends ModelFieldMap>(
  config: Omit<
    import('./handler.js').AdminHandlerConfig,
    'adapter' | 'models' | 'modelOrder' | 'navigation' | 'dashboard'
  > & {
    adapter?: import('./handler.js').AdminHandlerConfig['adapter'];
    prisma?: any;
    prismaSchemaPath?: string;
    modelOrder?: readonly (keyof Models & string)[];
    models?: { [Name in keyof Models]?: TypedModelConfig<Models[Name]> };
    navigation?: { categories?: Array<{ label: string; models: readonly (keyof Models & string)[] }> };
    dashboard?: TypedDashboardConfig<Models>;
  }
): typeof config {
  return config;
}
