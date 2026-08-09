/**
 * Query string parsing and Prisma `where` construction for list search
 * and filters.
 *
 * Design reference: docs/design/list-search-filters.md.
 *
 * Golden rule (§4.3 of the design doc): the query string SELECTS from a
 * finite whitelist of operators derived from the field's type. It never
 * describes a Prisma clause. No operator ever flows from the URL into the
 * `where` object as a key — the operator string from the URL is only ever
 * used to look up a fixed table; the table's value (never the URL's raw
 * string) becomes the Prisma operator key.
 */

import type { PrismaField, PrismaModel } from '../introspection/parser.js';
import { isSensitiveFieldName } from '../introspection/parser.js';

export type FilterOp = 'equals' | 'contains' | 'startsWith' | 'gte' | 'lte' | 'isnull';

export interface ActiveFilter {
  field: string;
  op: FilterOp;
  /** Already coerced to the JS type Prisma expects for this field/op. */
  value: unknown;
  /** Original string from the query string, kept to re-render the UI. */
  raw: string;
}

export interface IgnoredFilter {
  /** Raw query param key, e.g. "f.passwordHash" or "f.nope__gte". */
  param: string;
  reason: 'unknown-field' | 'not-filterable' | 'bad-operator' | 'bad-value';
}

export interface ListQuery {
  q: string | null;
  searchFields: string[];
  filters: ActiveFilter[];
  ignored: IgnoredFilter[];
}

/** Max length accepted for the free-text search term. Longer input is truncated. */
const MAX_SEARCH_LENGTH = 200;

/** Field-name candidates used both for relation labels and for the default search heuristic (§2.1). */
export const DEFAULT_LABEL_FIELDS = ['name', 'title', 'label', 'email', 'username', 'slug'];

/** Types eligible for the free-text search heuristic (String only, see §2.1). */
function isSearchableByHeuristic(field: PrismaField): boolean {
  return (
    field.type === 'String' &&
    !field.isList &&
    !field.relation &&
    !isSensitiveFieldName(field.name) &&
    !field.isId
  );
}

/**
 * Fields eligible for the free-text search box.
 *
 * Explicit `searchFields` config always wins. Otherwise: String fields,
 * not sensitive, not relation/list/id, whose name is in `labelFields`
 * (same list used for relation labels — one heuristic, not two that could
 * drift apart). Empty result means "no search box rendered", never a
 * fallback that scans every String column.
 */
export function resolveSearchFields(
  model: PrismaModel,
  configured: string[] | undefined,
  labelFields: string[] = DEFAULT_LABEL_FIELDS
): string[] {
  if (configured) {
    return configured.filter((name) => {
      const field = model.fields.find((f) => f.name === name);
      return field && isFilterableFieldType(field) && !isSensitiveFieldName(name);
    });
  }
  return model.fields
    .filter((f) => isSearchableByHeuristic(f) && labelFields.includes(f.name))
    .map((f) => f.name);
}

/** Whether a field's Prisma type can ever appear in a where clause we build (excludes Json/Bytes/relations/lists). */
function isFilterableFieldType(field: PrismaField): boolean {
  if (field.relation || field.isList) return false;
  return !['Json', 'Bytes'].includes(field.type);
}

/**
 * Whitelist of operators per Prisma scalar type. The URL provides a
 * *string* op name; this table is the only place that turns it into a
 * real Prisma operator. Anything not listed here for the field's type is
 * rejected (§4.3).
 */
function allowedOpsFor(field: PrismaField): FilterOp[] {
  if (field.isEnum) return ['equals'];
  switch (field.type) {
    case 'String':
      return ['equals', 'contains', 'startsWith'];
    case 'Int':
    case 'BigInt':
    case 'Float':
    case 'Decimal':
      return ['equals', 'gte', 'lte'];
    case 'Boolean':
      return ['equals'];
    case 'DateTime':
      return ['equals', 'gte', 'lte'];
    default:
      return [];
  }
}

/**
 * Coerce a raw query-string value to the JS type Prisma expects, or return
 * `undefined` if it can't be coerced.
 *
 * DateTime `equals`/`gte`/`lte` and enum membership are handled entirely
 * inside `parseOneFilter` and never reach this function; `allowedOpsFor`
 * already returns `[]` for Json/Bytes/relations/lists, so `parseOneFilter`
 * rejects those before reaching this function too. `isnull` DOES reach
 * here (it's field-type-agnostic), which is why it's handled first.
 */
function coerceValue(field: PrismaField, op: FilterOp, raw: string): unknown {
  if (op === 'isnull') {
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return undefined;
  }
  switch (field.type) {
    case 'String':
      return raw;
    case 'Int':
    case 'BigInt': {
      // Strict integer pattern — NOT parseInt: parseInt("12abc") === 12 and
      // parseInt("") is NaN silently. Both are real bugs the previous
      // `?filter=` implementation had (see docs/design §0.b).
      if (!/^-?\d+$/.test(raw)) return undefined;
      if (field.type === 'BigInt') {
        // `BigInt(str)` never throws once `raw` has already matched the
        // strict integer regex above — no try/catch needed, and a "just
        // in case" catch here would be unreachable code the coverage
        // threshold would force us to fake-test.
        return BigInt(raw);
      }
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : undefined;
    }
    case 'Float':
    case 'Decimal': {
      if (!/^-?\d+(\.\d+)?$/.test(raw)) return undefined;
      // Decimal is passed to Prisma as a string to avoid precision loss on
      // a round-trip through JS `Number`; Float uses the numeric value.
      return field.type === 'Decimal' ? raw : Number(raw);
    }
    case 'Boolean':
    default:
      // Boolean is the only remaining branch reachable in practice; the
      // `default` exists only so TypeScript accepts a non-exhaustive
      // switch over `string`, it carries no distinct behaviour.
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      return undefined;
  }
}

export interface DateRange {
  gte: Date;
  lt: Date;
}

/**
 * DateTime shortcuts, à la Django. Upper bound is always EXCLUSIVE (`lt`),
 * never `lte`: `lte 23:59:59.000` misses the last second's milliseconds,
 * a classic bug invisible in tests unless caught explicitly (§5.5).
 *
 * `now` is injectable so tests are deterministic (not "will break at
 * midnight UTC in CI").
 */
export function resolveDateShortcut(raw: string, now: () => Date = () => new Date()): DateRange | undefined {
  const today = () => {
    const d = now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

  if (raw === 'today') {
    const start = today();
    return { gte: start, lt: addDays(start, 1) };
  }
  if (raw === '7d') {
    const end = addDays(today(), 1);
    return { gte: addDays(today(), -6), lt: end };
  }
  if (raw === 'month') {
    const d = now();
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { gte: start, lt: end };
  }
  if (raw === 'year') {
    const d = now();
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
    return { gte: start, lt: end };
  }
  // A single ISO date (no time component): treat as a day-long interval,
  // never as `equals` — a DateTime stores a time, so `equals` on a bare
  // date never matches anything (§5.5).
  const dayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) {
    const [, y, m, d] = dayMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    // `Date.UTC` silently rolls over out-of-range components (month 13 ->
    // January next year); reject explicitly instead of trusting it.
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const start = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(start.getTime()) ||
      start.getUTCFullYear() !== year ||
      start.getUTCMonth() !== month - 1 ||
      start.getUTCDate() !== day
    ) {
      return undefined;
    }
    return { gte: start, lt: addDays(start, 1) };
  }
  return undefined;
}

/** Parse a `gte`/`lte` DateTime bound: full ISO datetime or a bare date. */
function parseDateBound(raw: string): Date | undefined {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

interface ParseContext {
  model: PrismaModel;
  enums: Map<string, string[]>;
  searchFields: string[];
  filterableFields: Set<string>;
  now?: () => Date;
}

/**
 * Split a `f.<field>` or `f.<field>__<op>` param name into its parts.
 * Cuts on the FIRST `__` after the `f.` prefix — Prisma identifiers can't
 * contain `__` at all in practice for this parser's purposes, so this is
 * unambiguous.
 *
 * Always called with a key that already starts with `f.` — both call
 * sites in `parseListQuery` guarantee it (one filters on it explicitly,
 * the other builds the string literally for the legacy `?filter=` path) —
 * so there's no `null`-returning guard here to fake-test.
 */
function splitFilterParam(key: string): { field: string; op: string | null } {
  const rest = key.slice(2);
  const sep = rest.indexOf('__');
  if (sep === -1) return { field: rest, op: null };
  return { field: rest.slice(0, sep), op: rest.slice(sep + 2) };
}

function parseOneFilter(
  param: string,
  raw: string,
  ctx: ParseContext
): { filter: ActiveFilter } | { ignored: IgnoredFilter } {
  const { field: fieldName, op: opParam } = splitFilterParam(param);
  const field = ctx.model.fields.find((f) => f.name === fieldName);

  // Sensitive field: rejected here too, not just by the caller's
  // `filterableFields` set — defense in depth. Same predicate as
  // `getDisplayFields`/relation labels (isSensitiveFieldName), and the
  // exact fix for the oracle described in docs/design §0.a: a sensitive
  // field is treated EXACTLY like an unknown one, never a distinct
  // "forbidden" message that would confirm its existence.
  if (!field || !ctx.filterableFields.has(fieldName) || isSensitiveFieldName(fieldName)) {
    return { ignored: { param, reason: 'unknown-field' } };
  }
  // Empty value (e.g. from a <select> "All" option submitted via a GET
  // form) means "no filter", not "filter on empty string" (§5.4).
  if (raw === '') {
    return { ignored: { param, reason: 'unknown-field' } };
  }

  const allowed = allowedOpsFor(field);
  if (allowed.length === 0) {
    return { ignored: { param, reason: 'not-filterable' } };
  }

  const wantsIsnull = opParam === 'isnull';
  const op: FilterOp = wantsIsnull ? 'isnull' : ((opParam as FilterOp) || 'equals');

  if (op === 'isnull') {
    if (field.isRequired) return { ignored: { param, reason: 'not-filterable' } };
  } else if (!allowed.includes(op)) {
    return { ignored: { param, reason: 'bad-operator' } };
  }

  if (field.type === 'DateTime' && op !== 'isnull') {
    if (op === 'equals') {
      const range = resolveDateShortcut(raw, ctx.now);
      if (!range) return { ignored: { param, reason: 'bad-value' } };
      // A day/shortcut becomes two filters merged by the caller into one
      // AND pair; represented here as a single filter carrying both
      // bounds so buildWhere can emit `{gte, lt}` from one ActiveFilter.
      return {
        filter: { field: fieldName, op: 'gte', value: range, raw }
      };
    }
    const bound = parseDateBound(raw);
    if (!bound) return { ignored: { param, reason: 'bad-value' } };
    return { filter: { field: fieldName, op, value: bound, raw } };
  }

  if (field.isEnum) {
    const members = ctx.enums.get(field.type) ?? [];
    if (!members.includes(raw)) return { ignored: { param, reason: 'bad-value' } };
    return { filter: { field: fieldName, op: 'equals', value: raw, raw } };
  }

  const value = coerceValue(field, op, raw);
  if (value === undefined) return { ignored: { param, reason: 'bad-value' } };
  return { filter: { field: fieldName, op, value, raw } };
}

/**
 * Parse `?q=` and `?f.*=` into a `ListQuery`. Pure function: no I/O, no
 * Prisma. `filterableFields` is the set of field names the caller allows
 * to be filtered (already validated against config/heuristics + the
 * shared sensitive-name predicate) — this function does not decide
 * *which* fields are filterable, only how to parse a value once a field
 * is known to be eligible.
 */
export function parseListQuery(
  searchParams: URLSearchParams,
  model: PrismaModel,
  enums: Map<string, string[]>,
  searchFields: string[],
  filterableFields: Set<string>,
  now?: () => Date
): ListQuery {
  const rawQ = searchParams.get('q');
  const q = rawQ && rawQ.trim() ? rawQ.trim().slice(0, MAX_SEARCH_LENGTH) : null;

  const ctx: ParseContext = { model, enums, searchFields, filterableFields, now };
  const filters: ActiveFilter[] = [];
  const ignored: IgnoredFilter[] = [];

  for (const [key] of searchParams) {
    if (!key.startsWith('f.')) continue;
    const raw = searchParams.get(key)!;
    const result = parseOneFilter(key, raw, ctx);
    if ('filter' in result) filters.push(result.filter);
    else ignored.push(result.ignored);
  }

  // Legacy `?filter=field:value` — routed through the exact same
  // whitelist/coercion path as `f.*`, so it inherits the security fix
  // (docs/design §4.4, §0.a). If both are present for the same field,
  // `f.*` wins (parsed above, so it's already in `filters`); the legacy
  // value is only added if that field has no `f.*` entry.
  const legacy = searchParams.get('filter');
  if (legacy && legacy.includes(':')) {
    const sep = legacy.indexOf(':');
    const legacyField = legacy.slice(0, sep);
    const legacyValue = legacy.slice(sep + 1);
    const alreadyHasField = filters.some((f) => f.field === legacyField);
    if (!alreadyHasField) {
      const result = parseOneFilter(`f.${legacyField}`, legacyValue, ctx);
      if ('filter' in result) filters.push(result.filter);
      else ignored.push({ param: 'filter', reason: result.ignored.reason });
    }
  }

  return { q, searchFields, filters, ignored };
}

/** A Prisma `where` clause built from a `ListQuery`. Opaque to callers — pass straight to Prisma. */
export type PrismaWhere = Record<string, unknown>;

function clauseOf(filter: ActiveFilter): Record<string, unknown> {
  if (filter.op === 'gte' && filter.value && typeof filter.value === 'object' && 'gte' in (filter.value as object)) {
    // Date shortcut carrying both bounds (see parseOneFilter's DateTime branch).
    const range = filter.value as DateRange;
    return { [filter.field]: { gte: range.gte, lt: range.lt } };
  }
  if (filter.op === 'isnull') {
    return { [filter.field]: filter.value ? { equals: null } : { not: null } };
  }
  if (filter.op === 'equals') {
    return { [filter.field]: filter.value };
  }
  return { [filter.field]: { [filter.op]: filter.value } };
}

/**
 * Compose the final Prisma `where`: `AND: [scope, ...filters, {OR: search}]`.
 * NEVER a spread — a spread of `{...scope, ...filterWhere}` lets a filter
 * on the same field as the developer's scoping silently overwrite it
 * (docs/design §0.c, the exact IDOR the previous `?filter=` had). Two
 * clauses on the same field inside `AND` intersect; they never merge.
 *
 * Returns `undefined` when nothing is active, so the query shape sent to
 * Prisma is byte-for-byte identical to today's unfiltered call — no
 * regression on existing snapshots/assertions.
 */
export function buildWhere(
  query: ListQuery,
  scope: Record<string, unknown> | undefined,
  caseInsensitiveSearch: boolean
): PrismaWhere | undefined {
  const and: Record<string, unknown>[] = [];
  if (scope) and.push(scope);
  for (const f of query.filters) and.push(clauseOf(f));

  if (query.q && query.searchFields.length > 0) {
    const or = query.searchFields.map((field) => ({
      [field]: caseInsensitiveSearch
        ? { contains: query.q, mode: 'insensitive' }
        : { contains: query.q }
    }));
    // Never emit `{OR: []}` — in Prisma that matches nothing, which would
    // silently turn "no searchable field" into "empty result" (§2.4).
    if (or.length > 0) and.push({ OR: or });
  }

  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0];
  return { AND: and };
}
