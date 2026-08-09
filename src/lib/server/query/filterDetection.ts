/**
 * Filter sidebar detection and configuration resolution.
 *
 * Design reference: docs/design/list-search-filters.md §3.5, §8.
 *
 * Auto-detection is intentionally narrow — Boolean and enum only — because
 * their value domain is known STATICALLY from the schema (zero extra query
 * to render the sidebar). Anything else (DateTime, FK, free String/Int)
 * requires explicit `listFilter` config. This is a deliberate perf guard:
 * an auto-detect heuristic that fires `groupBy`/`findMany` on every list
 * render is a trap that can't be removed later without a breaking change.
 */

import type { PrismaField, PrismaModel } from '../introspection/parser.js';
import { isSensitiveFieldName } from '../introspection/parser.js';

export type ListFilterConfigEntry =
  | string
  | { field: string; label?: string };

export interface ResolvedFilterField {
  field: string;
  label: string;
  /** 'boolean' offers a fixed [All, Yes, No] set; 'enum' offers one entry per member. */
  kind: 'boolean' | 'enum';
  /** Only present for kind 'enum'. */
  enumValues?: string[];
}

/** Whether a field is eligible for auto-detection: Boolean or enum, not sensitive/hidden/list/relation. */
function isAutoDetectable(field: PrismaField): boolean {
  if (field.relation || field.isList) return false;
  if (isSensitiveFieldName(field.name)) return false;
  return field.type === 'Boolean' || Boolean(field.isEnum);
}

/**
 * Validate a `listFilter` config entry against the schema at boot time.
 * Invalid config throws immediately — a developer typo (unknown field,
 * sensitive field, relation, Json/Bytes) should fail loud at startup, not
 * silently produce a sidebar entry that does nothing. This is a DIFFERENT
 * failure mode than a forged URL (§5.4 of the design doc): bad config is a
 * developer error, a bad URL is untrusted input that must degrade quietly.
 */
export function validateListFilterConfig(
  modelName: string,
  entries: ListFilterConfigEntry[],
  model: PrismaModel
): void {
  for (const entry of entries) {
    const fieldName = typeof entry === 'string' ? entry : entry.field;
    const field = model.fields.find((f) => f.name === fieldName);
    if (!field) {
      throw new Error(
        `[sveltekit-admin] listFilter: model "${modelName}" has no field "${fieldName}"`
      );
    }
    if (field.relation || field.isList) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" is a relation/list field, not filterable`
      );
    }
    if (['Json', 'Bytes'].includes(field.type)) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" is a ${field.type} field, not filterable`
      );
    }
    if (isSensitiveFieldName(fieldName)) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" looks sensitive by name, refusing to expose it as a filter`
      );
    }
    if (field.type !== 'Boolean' && !field.isEnum) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" has type ${field.type}, ` +
          `only Boolean and enum fields are supported by the sidebar filter in this version`
      );
    }
  }
}

/**
 * Resolve the filter sidebar entries for a model: explicit `listFilter`
 * config wins (already validated at boot by `validateListFilterConfig`),
 * otherwise the auto-detect heuristic (Boolean + enum fields).
 */
export function resolveListFilters(
  model: PrismaModel,
  enums: Map<string, string[]>,
  configured: ListFilterConfigEntry[] | undefined,
  toLabel: (name: string) => string
): ResolvedFilterField[] {
  const fieldNames = configured
    ? configured.map((e) => (typeof e === 'string' ? e : e.field))
    : model.fields.filter(isAutoDetectable).map((f) => f.name);

  const labelOf = (fieldName: string): string | undefined => {
    if (!configured) return undefined;
    const entry = configured.find((e) => (typeof e === 'string' ? e : e.field) === fieldName);
    return entry && typeof entry !== 'string' ? entry.label : undefined;
  };

  const out: ResolvedFilterField[] = [];
  for (const fieldName of fieldNames) {
    const field = model.fields.find((f) => f.name === fieldName);
    if (!field) continue; // Already validated at boot for explicit config; defensive no-op otherwise.
    if (field.type === 'Boolean') {
      out.push({ field: fieldName, label: labelOf(fieldName) ?? toLabel(fieldName), kind: 'boolean' });
    } else if (field.isEnum) {
      out.push({
        field: fieldName,
        label: labelOf(fieldName) ?? toLabel(fieldName),
        kind: 'enum',
        enumValues: enums.get(field.type) ?? []
      });
    }
  }
  return out;
}
