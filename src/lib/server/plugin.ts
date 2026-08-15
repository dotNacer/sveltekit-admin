import type { Filter } from './adapters/types.js';
import type { RelationGraph } from './introspection/relations.js';
import type { Model } from './types/schema.js';

export interface AdminPlugin {
  name: string;
  pages?: AdminPluginPage[];
  recordActions?: AdminPluginRecordAction[];
}

export interface AdminPluginPage {
  pattern: string[];
  models?: string[];
  render: (ctx: PluginPageContext) => PluginPageResult | Promise<PluginPageResult>;
}

export interface PluginPageResult {
  html: string;
  styles?: string;
  scripts?: string;
}

export interface AdminPluginRecordAction {
  label: string;
  models?: string[];
  href: (ctx: { model: string; id: string | number; basePath: string }) => string;
}

export interface PluginPageContext {
  event: any;
  route: { view: string; model?: string; id?: string };
  basePath: string;
  /** Set only when the page pattern captures `:id` (after a 404 skip). */
  record?: Record<string, unknown>;
  escapeHtml: (s: string) => string;
  findModel: (name?: string) => Model | undefined;
  relationGraph: RelationGraph | null;
  resolveLabel: (
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ) => string;
  hiddenFieldsOf: (model: Model) => Set<string>;
  isSensitiveFieldName: (name: string) => boolean;
  loadRecord: (
    modelName: string,
    id: string | number
  ) => Promise<Record<string, unknown> | null>;
  listRecords: (
    modelName: string,
    extraFilter?: Filter
  ) => Promise<Record<string, unknown>[]>;
  getM2mSelectedIds: (
    modelName: string,
    fieldName: string,
    recordId: string | number
  ) => Promise<Array<string | number>>;
}
