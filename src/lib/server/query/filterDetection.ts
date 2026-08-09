/**
 * Filter sidebar detection and configuration resolution.
 *
 * Design reference: docs/design/list-search-filters.md §3.5, §5.5, §6, §8.
 *
 * Auto-detection is intentionally narrow — Boolean and enum only — because
 * their value domain is known STATICALLY from the schema (zero extra query
 * to render the sidebar). DateTime, numeric ranges, and FK all require
 * explicit `listFilter` config (DateTime presets are an editorial choice,
 * ranges need two inputs not a fixed set, FK needs a query to load options
 * — see §3.5, §6.2). This is a deliberate perf guard: an auto-detect
 * heuristic that fires `groupBy`/`findMany` on every list render is a trap
 * that can't be removed later without a breaking change.
 */

import type { PrismaField, PrismaModel } from '../introspection/parser.js';
import { isSensitiveFieldName } from '../introspection/parser.js';
import type { RelationGraph } from '../introspection/relations.js';

const NUMERIC_TYPES = ['Int', 'Float', 'Decimal', 'BigInt'];
export const DATETIME_PRESETS = ['today', '7d', 'month', 'year'] as const;
export type DateTimePreset = (typeof DATETIME_PRESETS)[number];

export type ListFilterConfigEntry =
  | string
  | {
      field: string;
      label?: string;
      /** DateTime only: which shortcuts to offer as sidebar links (default: all four, §5.5). */
      presets?: DateTimePreset[];
      /** Numeric field only: render two `gte`/`lte` inputs in a GET form instead of a fixed link set. */
      range?: boolean;
    };

export interface ResolvedFilterField {
  field: string;
  label: string;
  kind: 'boolean' | 'enum' | 'datetime' | 'range' | 'fk';
  /** Only present for kind 'enum'. */
  enumValues?: string[];
  /** Only present for kind 'datetime'. */
  presets?: DateTimePreset[];
}

/** A filter entry that was configured as an FK scalar (e.g. `authorId` on Post), with its target relation resolved. */
export interface FkFilterSpec {
  /** Scalar FK field name, e.g. `authorId`. */
  field: string;
  label: string;
  /** Owning relation field name on this model, e.g. `author`. */
  relationField: string;
  /** Target model name, e.g. `User`. */
  targetModel: string;
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
  model: PrismaModel,
  relationGraph?: RelationGraph
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
    const range = typeof entry !== 'string' && entry.range;
    const presets = typeof entry !== 'string' ? entry.presets : undefined;

    if (range && !NUMERIC_TYPES.includes(field.type)) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" has range:true but type ${field.type} is not numeric`
      );
    }
    if (presets && field.type !== 'DateTime') {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" has presets but is not a DateTime field`
      );
    }
    if (presets) {
      const invalid = presets.filter((p) => !(DATETIME_PRESETS as readonly string[]).includes(p));
      if (invalid.length > 0) {
        throw new Error(
          `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" has unknown preset(s) ${invalid.join(', ')}, ` +
            `expected one of ${DATETIME_PRESETS.join(', ')}`
        );
      }
    }

    // Un scalaire FK (to-one owning) est un cas légitime de config explicite
    // — les options seront chargées et scopées au moment du rendu, jamais
    // auto-détectées (docs/design §3.5, §6).
    const isFk = Boolean(relationGraph && findFkEdge(relationGraph, modelName, fieldName));

    // Champ finalement supporté par la sidebar si : Boolean, enum, DateTime
    // (avec ou sans presets), numérique avec range:true, ou scalaire FK.
    // Tout le reste (String libre, Int/Float sans range, Json déjà rejeté
    // plus haut) est refusé — pas de filtre silencieusement mort.
    const supported =
      field.type === 'Boolean' ||
      field.isEnum ||
      field.type === 'DateTime' ||
      (range && NUMERIC_TYPES.includes(field.type)) ||
      isFk;
    if (!supported) {
      throw new Error(
        `[sveltekit-admin] listFilter: "${modelName}.${fieldName}" has type ${field.type}, ` +
          `only Boolean, enum, DateTime, range:true numeric, and FK scalar fields are supported by the sidebar filter`
      );
    }
  }
}

/**
 * Trouve l'arête to-one-owning qui porte ce scalaire FK sur ce modèle, si
 * elle existe. Lookup direct sur `edges` avec la clé `"Model.field"` — on ne
 * passe PAS par `scalarToRelation` (indexée par nom de champ seul, donc
 * ambiguë si deux modèles ont une FK du même nom, ex: `Post.authorId` et
 * `Comment.authorId`).
 */
export function findFkEdge(
  relationGraph: RelationGraph,
  modelName: string,
  scalarFieldName: string
) {
  for (const edge of relationGraph.edges.values()) {
    if (
      edge.model === modelName &&
      edge.kind === 'to-one-owning' &&
      !edge.unsupported &&
      edge.scalarFields.length === 1 &&
      edge.scalarFields[0] === scalarFieldName
    ) {
      return edge;
    }
  }
  return undefined;
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
  toLabel: (name: string) => string,
  relationGraph?: RelationGraph
): ResolvedFilterField[] {
  const fieldNames = configured
    ? configured.map((e) => (typeof e === 'string' ? e : e.field))
    : model.fields.filter(isAutoDetectable).map((f) => f.name);

  const entryOf = (fieldName: string) =>
    configured?.find((e) => (typeof e === 'string' ? e : e.field) === fieldName);
  const labelOf = (fieldName: string): string | undefined => {
    const entry = entryOf(fieldName);
    return entry && typeof entry !== 'string' ? entry.label : undefined;
  };

  const out: ResolvedFilterField[] = [];
  for (const fieldName of fieldNames) {
    const field = model.fields.find((f) => f.name === fieldName);
    if (!field) continue; // Already validated at boot for explicit config; defensive no-op otherwise.
    const entry = entryOf(fieldName);
    const range = Boolean(entry && typeof entry !== 'string' && entry.range);
    const label = labelOf(fieldName) ?? toLabel(fieldName);

    if (range && NUMERIC_TYPES.includes(field.type)) {
      out.push({ field: fieldName, label, kind: 'range' });
    } else if (field.type === 'DateTime') {
      const presets =
        (entry && typeof entry !== 'string' ? entry.presets : undefined) ?? [...DATETIME_PRESETS];
      out.push({ field: fieldName, label, kind: 'datetime', presets });
    } else if (field.type === 'Boolean') {
      out.push({ field: fieldName, label, kind: 'boolean' });
    } else if (field.isEnum) {
      out.push({ field: fieldName, label, kind: 'enum', enumValues: enums.get(field.type) ?? [] });
    } else if (relationGraph && findFkEdge(relationGraph, model.name, fieldName)) {
      out.push({ field: fieldName, label, kind: 'fk' });
    }
  }
  return out;
}
