# Drizzle Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `createDrizzleAdapter({ db, schema })` via `sveltekit-admin/adapters/drizzle` with Prisma-parity admin (list/form/dashboard/relations/m2m/filters/`listWhere` flat sugar), without changing observable Prisma behavior.

**Architecture:** A new `src/lib/server/adapters/drizzle/` package walks a runtime Drizzle schema object (`extractTablesRelationalConfig` + `relations()` v1) into the existing lingua-franca `Schema`, compiles `Filter` to drizzle SQL, and implements `DataAdapter` with the query builder (not `db.query`). Tiny generic-layer changes: shared Filter predicates, `containsExact`, flat-scope sugar in `buildWhere`, `_search` no longer injects a Prisma `{ contains }` object. `@prisma/client` and `drizzle-orm` become optional peers.

**Tech Stack:** TypeScript, Vitest, bun, `drizzle-orm` `>=0.32.0`, `better-sqlite3` (dev/integration only). No new runtime dependency of the Prisma entry.

**Spec:** `docs/superpowers/specs/2026-08-14-drizzle-adapter-design.md`

## Global Constraints

- 100% coverage (lines/statements/functions/branches) on `src/lib/**`. No `exclude`, no `v8 ignore`.
- Zero observable Prisma change: `tests/characterization/handler.snapshot.test.ts`, `tests/integration/handler.db.test.ts`, `tests/integration/handler.m2m.db.test.ts`, and `tests/integration/setup.ts` stay unmodified.
- `createDrizzleAdapter` is NOT re-exported from `src/lib/index.ts`. `RUNTIME_EXPORTS` stays five functions.
- `handler.ts` never imports `drizzle-orm`. Drizzle enters only via `config.adapter`.
- `buildRelationGraph` is not rewritten. Introspector emits Schema that the existing graph understands (including synthesized m2m as two list fields without `fields:`).
- Discrimination of Filter nodes is structural (`isLeafFilter` / `isCompositeFilter`), never `'op' in node` alone.
- Package manager is **bun**. Single-file tests: `bunx vitest run <path>`. Full suite: `bun run test`. Types: `bun run check`. Lint: `bun run lint`. Run `bun run test:gen` once in a fresh shell before tests.
- Do not implement `defineRelations` v2, file parsing, `{ drizzle }` shorthand, Kysely, `formDataToPrisma` rename, async introspect, nested Prisma `where` on Drizzle, self-ref m2m synthesis, docs site, or `example/` Drizzle app.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/adapters/filter.ts` | Shared `LEAF_OPS`, `isCompositeFilter`, `isLeafFilter`, `isFlatEqMap`, `normalizeScope` |
| `src/lib/server/adapters/types.ts` | Add `'containsExact'` to `LeafFilter.op` |
| `src/lib/server/adapters/prisma/filterCompiler.ts` | Import shared predicates; `containsExact` → `{ contains }` without `mode` |
| `src/lib/server/query/listQuery.ts` | `buildWhere` runs `normalizeScope` on `scope` |
| `src/lib/server/handler.ts` | `_search` uses `containsExact`; boot warn « Could not introspect schema » |
| `src/lib/server/adapters/drizzle/inspect.ts` | Schema object → `{ schema, tables, m2m, dialect }` |
| `src/lib/server/adapters/drizzle/introspector.ts` | `SchemaIntrospector` wrapping `inspect` |
| `src/lib/server/adapters/drizzle/filterCompiler.ts` | `Filter` → drizzle `SQL` |
| `src/lib/server/adapters/drizzle/dataAdapter.ts` | `DataAdapter` query builder + pivot m2m |
| `src/lib/server/adapters/drizzle/index.ts` | `createDrizzleAdapter` |
| `package.json` | `exports["./adapters/drizzle"]`, optional peers |
| `tests/fixtures/drizzle/schema.ts` | Shared sqlite schema (users/posts/tags/postsToTags + relations) |
| `tests/unit/adapters/filter.test.ts` | Shared predicates + `normalizeScope` |
| `tests/unit/adapters/drizzle/*.test.ts` | inspect / compiler / dataAdapter / factory |
| `tests/integration/handler.drizzle.db.test.ts` | Real in-memory sqlite through the handler |
| `.changeset/drizzle-adapter.md` | minor changeset |
| `README.md` | Drizzle snippet |

---

## Task 1: Optional peers + drizzle-orm devDependency

**Files:**
- Modify: `package.json`
- Test: none yet (verified by `bun pm ls` + later import tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `drizzle-orm` and `better-sqlite3` importable in tests; `peerDependencies["drizzle-orm"]` = `>=0.32.0`; both `@prisma/client` and `drizzle-orm` optional.

- [ ] **Step 1: Install dev dependencies**

Run:

```bash
bun add -d drizzle-orm better-sqlite3 @types/better-sqlite3
```

Expected: `bun.lock` updates; packages appear under `devDependencies`.

- [ ] **Step 2: Mark peers optional**

In `package.json`, keep existing `peerDependencies` and add `drizzle-orm`, then add `peerDependenciesMeta`:

```json
"peerDependencies": {
  "@prisma/client": ">=5.0.0",
  "@sveltejs/kit": ">=2.0.0",
  "drizzle-orm": ">=0.32.0",
  "svelte": ">=5.0.0"
},
"peerDependenciesMeta": {
  "@prisma/client": { "optional": true },
  "drizzle-orm": { "optional": true }
}
```

Do not add `exports["./adapters/drizzle"]` yet — that lands in Task 9 with the factory file, so `bun run package` never points at a missing file mid-plan.

- [ ] **Step 3: Smoke-import drizzle**

Run:

```bash
bun -e "import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'; import { relations } from 'drizzle-orm'; console.log(typeof sqliteTable, typeof relations)"
```

Expected: `function function`

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
chore: add optional drizzle-orm peer and sqlite test driver

EOF
)"
```

---

## Task 2: Shared Filter predicates + `containsExact`

**Files:**
- Create: `src/lib/server/adapters/filter.ts`
- Create: `tests/unit/adapters/filter.test.ts`
- Modify: `src/lib/server/adapters/types.ts` (`LeafFilter.op`)
- Modify: `src/lib/server/adapters/prisma/filterCompiler.ts`
- Modify: `tests/unit/adapters/prisma/filterCompiler.test.ts`
- Test: `tests/unit/adapters/filter.test.ts`, `tests/unit/adapters/prisma/filterCompiler.test.ts`

**Interfaces:**
- Consumes: `CompositeFilter`, `Filter`, `LeafFilter` from `adapters/types.ts`.
- Produces: `LEAF_OPS`, `isCompositeFilter`, `isLeafFilter`, `isFlatEqMap`, `normalizeScope`. `LeafFilter.op` includes `'containsExact'`. Prisma compiler maps `containsExact` → `{ [field]: { contains: value } }` with no `mode`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/adapters/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isCompositeFilter, isLeafFilter, isFlatEqMap, normalizeScope } from '../../../src/lib/server/adapters/filter.js';

describe('isLeafFilter / isCompositeFilter — discrimination structurelle', () => {
  it('leaf reconnue seulement avec op whitelisté + field string', () => {
    expect(isLeafFilter({ op: 'eq', field: 'id', value: 1 })).toBe(true);
    expect(isLeafFilter({ op: 'containsExact', field: 'name', value: 'x' })).toBe(true);
    expect(isLeafFilter({ op: 'read', field: 'id' })).toBe(false);
    expect(isLeafFilter({ op: 'eq' })).toBe(false);
  });

  it('composite reconnue seulement avec and/or + clauses array', () => {
    expect(isCompositeFilter({ op: 'and', clauses: [] })).toBe(true);
    expect(isCompositeFilter({ op: 'and', tenantId: 1 })).toBe(false);
  });
});

describe('isFlatEqMap / normalizeScope', () => {
  it('objet plat de scalaires → eq (une clé) ou and (plusieurs)', () => {
    expect(isFlatEqMap({ tenantId: 1 })).toBe(true);
    expect(normalizeScope({ tenantId: 1 })).toEqual({ op: 'eq', field: 'tenantId', value: 1 });
    expect(normalizeScope({ tenantId: 1, published: true })).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', field: 'tenantId', value: 1 },
        { op: 'eq', field: 'published', value: true }
      ]
    });
  });

  it('accepte Date, bigint, null comme scalaires ; refuse undefined, objet, tableau, {}', () => {
    expect(isFlatEqMap({ at: new Date('2020-01-01T00:00:00.000Z') })).toBe(true);
    expect(isFlatEqMap({ n: 1n })).toBe(true);
    expect(isFlatEqMap({ x: null })).toBe(true);
    expect(isFlatEqMap({ x: undefined })).toBe(false);
    expect(isFlatEqMap({ author: { is: { tenantId: 1 } } })).toBe(false);
    expect(isFlatEqMap({ id: { in: [1, 2] } })).toBe(false);
    expect(isFlatEqMap({})).toBe(false);
  });

  it('Filter déjà formé : renvoyé tel quel', () => {
    const leaf = { op: 'eq' as const, field: 'id', value: 1 };
    expect(normalizeScope(leaf)).toBe(leaf);
    const and = { op: 'and' as const, clauses: [leaf] };
    expect(normalizeScope(and)).toBe(and);
  });

  it('opaque (where Prisma imbriqué) : renvoyé tel quel', () => {
    const nested = { author: { is: { tenantId: 1 } } };
    expect(normalizeScope(nested)).toBe(nested);
  });

  it('undefined → undefined', () => {
    expect(normalizeScope(undefined)).toBeUndefined();
  });
});
```

Add at the end of `tests/unit/adapters/prisma/filterCompiler.test.ts`:

```ts
  it('leaf containsExact → { contains } sans mode, même si caseInsensitiveSearch', () => {
    expect(compileFilterToPrismaWhere({ op: 'containsExact', field: 'name', value: 'ALI' }, true)).toEqual({
      name: { contains: 'ALI' }
    });
    expect(compileFilterToPrismaWhere({ op: 'containsExact', field: 'name', value: 'ALI' }, false)).toEqual({
      name: { contains: 'ALI' }
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/adapters/filter.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts`

Expected: FAIL — `filter.ts` missing; `containsExact` not in the union / not compiled.

- [ ] **Step 3: Add `'containsExact'` to `LeafFilter`**

In `src/lib/server/adapters/types.ts`, replace the `LeafFilter.op` line with:

```ts
  op: 'eq' | 'contains' | 'containsExact' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull';
```

- [ ] **Step 4: Create `src/lib/server/adapters/filter.ts`**

```ts
import type { CompositeFilter, Filter, LeafFilter } from './types.js';

export const LEAF_OPS = new Set<LeafFilter['op']>([
  'eq',
  'contains',
  'containsExact',
  'startsWith',
  'gte',
  'lte',
  'lt',
  'in',
  'isNull',
  'isNotNull'
]);

export function isCompositeFilter(node: unknown): node is CompositeFilter {
  return (
    typeof node === 'object' &&
    node !== null &&
    'op' in node &&
    (node.op === 'and' || node.op === 'or') &&
    'clauses' in node &&
    Array.isArray((node as { clauses: unknown }).clauses)
  );
}

export function isLeafFilter(node: unknown): node is LeafFilter {
  return (
    typeof node === 'object' &&
    node !== null &&
    'op' in node &&
    typeof (node as { op: unknown }).op === 'string' &&
    LEAF_OPS.has((node as { op: LeafFilter['op'] }).op) &&
    'field' in node &&
    typeof (node as { field: unknown }).field === 'string'
  );
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value instanceof Date
  );
}

/** Flat `{ field: scalar }` map — the 99% listWhere sugar. Empty `{}` is NOT flat (handler throws on listWhere `{}`; other callers keep it opaque). */
export function isFlatEqMap(node: unknown): node is Record<string, string | number | boolean | bigint | Date | null> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  if (isLeafFilter(node) || isCompositeFilter(node)) return false;
  const values = Object.values(node as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.every(isScalar);
}

function flatEqMapToFilter(map: Record<string, unknown>): Filter {
  const clauses: LeafFilter[] = Object.entries(map).map(([field, value]) => ({
    op: 'eq',
    field,
    value
  }));
  if (clauses.length === 1) return clauses[0];
  return { op: 'and', clauses };
}

/**
 * Turns a listWhere / relations.where return value into a Filter when we can
 * do so without guessing. Nested Prisma where objects stay opaque.
 */
export function normalizeScope(
  scope: Record<string, unknown> | Filter | undefined
): Filter | Record<string, unknown> | undefined {
  if (scope === undefined) return undefined;
  if (isLeafFilter(scope) || isCompositeFilter(scope)) return scope;
  if (isFlatEqMap(scope)) return flatEqMapToFilter(scope);
  return scope;
}
```

- [ ] **Step 5: Point Prisma `filterCompiler.ts` at the shared predicates + `containsExact`**

Replace the file with:

```ts
/**
 * Compiles the generic `Filter` AST (see ../types.ts) into a Prisma `where`
 * object. This is the ONLY place in the Prisma adapter that knows Prisma's
 * where-clause vocabulary (`AND`/`OR`/`contains`/`startsWith`/`gte`/`lte`/
 * `equals`/`not`/`in`/`mode: 'insensitive'`).
 */
import type { Filter, LeafFilter } from '../types.js';
import { isCompositeFilter, isLeafFilter } from '../filter.js';

export type PrismaWhere = Record<string, unknown>;

function compileLeaf(filter: LeafFilter, caseInsensitiveSearch: boolean): PrismaWhere {
  switch (filter.op) {
    case 'eq':
      return { [filter.field]: filter.value };
    case 'contains':
      return caseInsensitiveSearch
        ? { [filter.field]: { contains: filter.value, mode: 'insensitive' } }
        : { [filter.field]: { contains: filter.value } };
    case 'containsExact':
      return { [filter.field]: { contains: filter.value } };
    case 'startsWith':
      return { [filter.field]: { startsWith: filter.value } };
    case 'gte':
      return { [filter.field]: { gte: filter.value } };
    case 'lte':
      return { [filter.field]: { lte: filter.value } };
    case 'lt':
      return { [filter.field]: { lt: filter.value } };
    case 'in':
      return { [filter.field]: { in: filter.value } };
    case 'isNull':
      return { [filter.field]: { equals: null } };
    case 'isNotNull':
      return { [filter.field]: { not: null } };
  }
}

function compile(node: Filter | PrismaWhere, caseInsensitiveSearch: boolean): PrismaWhere {
  if (isCompositeFilter(node)) {
    const clauses = node.clauses.map((c) => compile(c, caseInsensitiveSearch));
    return node.op === 'and' ? { AND: clauses } : { OR: clauses };
  }
  if (isLeafFilter(node)) {
    return compileLeaf(node, caseInsensitiveSearch);
  }
  return node as PrismaWhere;
}

export function compileFilterToPrismaWhere(
  filter: Filter | PrismaWhere | undefined,
  caseInsensitiveSearch: boolean
): PrismaWhere | undefined {
  if (filter === undefined) return undefined;
  return compile(filter, caseInsensitiveSearch);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/adapters/filter.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts`

Expected: PASS.

Run: `bun run check`

Expected: PASS (`compileLeaf` switch is exhaustive on the widened union).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/adapters/filter.ts src/lib/server/adapters/types.ts src/lib/server/adapters/prisma/filterCompiler.ts tests/unit/adapters/filter.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts
git commit -m "$(cat <<'EOF'
refactor: share Filter predicates and add containsExact

EOF
)"
```

---

## Task 3: Flat-scope sugar in `buildWhere`

**Files:**
- Modify: `src/lib/server/query/listQuery.ts` (`buildWhere`)
- Modify: `tests/unit/listQuery.test.ts` (the two tests that assert a raw `{ tenantId: 1 }` scope node)
- Test: `tests/unit/listQuery.test.ts`

**Interfaces:**
- Consumes: `normalizeScope` from `adapters/filter.ts`.
- Produces: `buildWhere(..., { tenantId: 1 }, ...)` returns `{ op: 'eq', field: 'tenantId', value: 1 }` instead of the raw object. Prisma-compiled `where` for that leaf is still `{ tenantId: 1 }`. Nested `{ author: { is: … } }` stays opaque.

- [ ] **Step 1: Write the failing assertions**

In `tests/unit/listQuery.test.ts`, replace these two tests inside `describe('buildWhere — composition AND, jamais de spread (Filter générique)')`:

```ts
  it('le scope seul, sans wrapper and, quand aucun filtre n\'est actif', () => {
    expect(buildWhere(empty, { tenantId: 1 }, false, Article)).toEqual({
      op: 'eq',
      field: 'tenantId',
      value: 1
    });
  });
```

and

```ts
  it('scope + filtre → and explicite, scope en premier', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'views', op: 'equals', value: 5, raw: '5' }], ignored: [] };
    expect(buildWhere(lq, { tenantId: 1 }, false, Article)).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', field: 'tenantId', value: 1 },
        { op: 'eq', field: 'views', value: 5 }
      ]
    });
  });
```

and

```ts
  it('un filtre sur le MÊME champ que le scope ne l\'écrase jamais (and, pas de spread)', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'tenantId', op: 'equals', value: 2, raw: '2' }], ignored: [] };
    const where = buildWhere(lq, { tenantId: 1 }, false, Article);
    expect(where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', field: 'tenantId', value: 1 },
        { op: 'eq', field: 'tenantId', value: 2 }
      ]
    });
  });
```

Find the test `'recherche + filtre + scope ensemble → un seul and cohérent'` and any other assertion that still expects `{ tenantId: 1 }` as a raw clause inside `clauses` — change that clause to `{ op: 'eq', field: 'tenantId', value: 1 }`. Leave tests that pass a nested Prisma object (if any) asserting the opaque object.

Add:

```ts
  it('un scope Prisma imbriqué reste opaque (pas de sucre)', () => {
    const nested = { author: { is: { tenantId: 1 } } };
    expect(buildWhere(empty, nested, false, Article)).toEqual(nested);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/listQuery.test.ts -t "scope"`

Expected: FAIL — `buildWhere` still pushes the raw object.

- [ ] **Step 3: Implement `normalizeScope` in `buildWhere`**

At the top of `src/lib/server/query/listQuery.ts`, add:

```ts
import { normalizeScope } from '../adapters/filter.js';
```

Replace `buildWhere` (keep the unused `caseInsensitiveSearch` param — call sites still pass it; do not add a coverage-breaking default-case) with:

```ts
/**
 * Compose the final generic `Filter`: `and: [scope, ...filters, {or: search}]`.
 * NEVER a spread. Flat `{ tenantId: 1 }` scopes become `eq` leaves via
 * `normalizeScope`; nested Prisma where objects stay opaque for the Prisma
 * compiler. Drizzle's compiler throws on those opaques.
 */
export function buildWhere(
  query: ListQuery,
  scope: Record<string, unknown> | undefined,
  caseInsensitiveSearch: boolean,
  model: PrismaModel
): Filter | Record<string, unknown> | undefined {
  const and: (Filter | Record<string, unknown>)[] = [];
  const normalized = normalizeScope(scope);
  if (normalized) and.push(normalized);
  for (const f of query.filters) and.push(...clauseOf(f));

  if (query.q && query.searchFields.length > 0) {
    const or: Filter[] = [];
    for (const fieldName of query.searchFields) {
      const field = model.fields.find((f) => f.name === fieldName);
      const clause = searchClauseFor(field, fieldName, query.q);
      if (clause) or.push(clause);
    }
    if (or.length > 0) and.push({ op: 'or', clauses: or });
  }

  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0];
  return { op: 'and', clauses: and } as Filter;
}
```

Leave the `caseInsensitiveSearch` parameter in the signature (call sites still pass it). It is already unused in today's `buildWhere`; do not add `void` or rename it.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/unit/listQuery.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts tests/characterization/handler.snapshot.test.ts`

Expected: PASS. Characterization HTML unchanged because Prisma still compiles `eq` to `{ tenantId: 1 }`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/query/listQuery.ts tests/unit/listQuery.test.ts
git commit -m "$(cat <<'EOF'
refactor: normalize flat listWhere scopes into Filter eq leaves

EOF
)"
```

---

## Task 4: `_search` uses `containsExact` + generic boot warning

**Files:**
- Modify: `src/lib/server/handler.ts` (the `handleSearch` filter construction ~L571–584, and the boot `console.warn` ~L236)
- Test: `tests/unit/search.test.ts` (existing `mode` assertion must still pass)

**Interfaces:**
- Consumes: `containsExact` leaf (Task 2).
- Produces: `_search` with `q=` sends `{ op: 'and', clauses: [configWhere, { op: 'containsExact', field, value: q }] }` instead of `{ [field]: { contains: q } }`. Prisma compile: `{ contains }` without `mode` — same as today.

- [ ] **Step 1: Baseline**

Run: `bunx vitest run tests/unit/search.test.ts`

Expected: PASS on current code.

- [ ] **Step 2: Rewrite `handleSearch` filter construction**

Replace the comment + `searchFilter` block in `handler.ts` with:

```ts
    // `_search` must stay case-sensitive on every adapter/provider. A
    // `{ op: 'contains' }` leaf would pick up the adapter-wide
    // `caseInsensitiveSearch` flag (Prisma `mode: 'insensitive'`, Drizzle
    // `ilike`). `containsExact` compiles to `{ contains }` / `LIKE` with
    // no case-folding — same observable Prisma behavior as the previous
    // opaque `{ [field]: { contains: q } }` pass-through.
    const searchFilter: any =
      q && searchField
        ? { op: 'and', clauses: [configWhere, { op: 'containsExact', field: searchField, value: q }] }
        : configWhere;
```

Replace:

```ts
    console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
```

with:

```ts
    console.warn('[sveltekit-admin] Could not introspect schema:', e);
```

- [ ] **Step 3: Run tests**

Run: `bunx vitest run tests/unit/search.test.ts tests/unit/handler.test.ts tests/characterization/handler.snapshot.test.ts`

Expected: PASS. The search test that stringifies Prisma call args and forbids `'mode'` still holds: `containsExact` compiles without `mode`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/handler.ts
git commit -m "$(cat <<'EOF'
fix: compile _search contains as containsExact so Drizzle can run it

EOF
)"
```

---

## Task 5: Drizzle inspect — tables, types, dialect (no relations)

**Files:**
- Create: `tests/fixtures/drizzle/schema.ts`
- Create: `src/lib/server/adapters/drizzle/inspect.ts`
- Create: `tests/unit/adapters/drizzle/inspect.test.ts`
- Test: `tests/unit/adapters/drizzle/inspect.test.ts`

**Interfaces:**
- Consumes: drizzle `sqliteTable` / `pgTable` / `mysqlTable`, `extractTablesRelationalConfig`, `createTableRelationsHelpers`, `is`, `Table`.
- Produces: `inspectDrizzleSchema(schema, dialect?)` → `{ schema: Schema, tables: Record<string, Table>, m2m: Map<string, M2mLink>, dialect: 'postgresql' | 'mysql' | 'sqlite' }`. For this task `m2m` may be empty and relation fields absent. `Model.name` = JS export key. `Schema.provider` = dialect.

- [ ] **Step 1: Write the fixture schema**

Create `tests/fixtures/drizzle/schema.ts`:

```ts
import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  name: text('name'),
  tenantId: integer('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  authorId: integer('author_id').notNull().references(() => users.id)
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull()
});

export const postsToTags = sqliteTable(
  'posts_to_tags',
  {
    postId: integer('post_id').notNull().references(() => posts.id),
    tagId: integer('tag_id').notNull().references(() => tags.id)
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.tagId] }) })
);

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts)
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  postsToTags: many(postsToTags)
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postsToTags: many(postsToTags)
}));

export const postsToTagsRelations = relations(postsToTags, ({ one }) => ({
  post: one(posts, { fields: [postsToTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postsToTags.tagId], references: [tags.id] })
}));
```

- [ ] **Step 2: Write the failing inspect tests (tables only)**

Create `tests/unit/adapters/drizzle/inspect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { pgEnum, pgTable, serial, text as pgText } from 'drizzle-orm/pg-core';
import { inspectDrizzleSchema } from '../../../../src/lib/server/adapters/drizzle/inspect.js';
import * as full from '../../../fixtures/drizzle/schema.js';

describe('inspectDrizzleSchema — tables / types / dialect', () => {
  it('Model.name = clé d\'export JS, Field.name = clé JS colonne', () => {
    const { schema, dialect, tables } = inspectDrizzleSchema(full);
    expect(dialect).toBe('sqlite');
    expect(schema.provider).toBe('sqlite');
    expect(schema.models.map((m) => m.name).sort()).toEqual(
      ['posts', 'postsToTags', 'tags', 'users'].sort()
    );
    const users = schema.models.find((m) => m.name === 'users')!;
    expect(users.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['id', 'email', 'name', 'tenantId', 'createdAt'])
    );
    expect(users.fields.find((f) => f.name === 'id')).toMatchObject({
      type: 'Int',
      isId: true,
      isRequired: true
    });
    expect(users.fields.find((f) => f.name === 'email')).toMatchObject({
      type: 'String',
      isRequired: true
    });
    expect(users.fields.find((f) => f.name === 'name')).toMatchObject({
      type: 'String',
      isRequired: false
    });
    expect(users.fields.find((f) => f.name === 'createdAt')).toMatchObject({
      type: 'DateTime',
      isCreatedAt: true
    });
    expect(tables.users).toBe(full.users);
  });

  it('schéma vide → models [] sans throw', () => {
    const { schema } = inspectDrizzleSchema({});
    expect(schema.models).toEqual([]);
  });

  it('ignore les exports non-Table (relations, helpers)', () => {
    const { schema } = inspectDrizzleSchema(full);
    expect(schema.models.find((m) => m.name === 'usersRelations')).toBeUndefined();
  });

  it('infère postgresql depuis pgTable', () => {
    const users = pgTable('users', { id: serial('id').primaryKey(), name: pgText('name') });
    const { dialect } = inspectDrizzleSchema({ users });
    expect(dialect).toBe('postgresql');
  });

  it('throw si tables de dialectes mixtes', () => {
    const sqliteUsers = sqliteTable('users', { id: integer('id').primaryKey() });
    const pgUsers = pgTable('others', { id: serial('id').primaryKey() });
    expect(() => inspectDrizzleSchema({ sqliteUsers, pgUsers })).toThrow(/mixed table dialects/);
  });

  it('dialect optionnel identique à l\'inférence est accepté', () => {
    const users = sqliteTable('users', { id: integer('id').primaryKey(), name: text('name') });
    expect(inspectDrizzleSchema({ users }, 'sqlite').dialect).toBe('sqlite');
  });

  it('pgEnum → isEnum + Schema.enums', () => {
    const role = pgEnum('role', ['admin', 'user']);
    const members = pgTable('members', { id: serial('id').primaryKey(), role: role('role') });
    const { schema } = inspectDrizzleSchema({ members, role });
    const field = schema.models.find((m) => m.name === 'members')!.fields.find((f) => f.name === 'role')!;
    expect(field.isEnum).toBe(true);
    expect([...schema.enums.values()].some((v) => v.includes('admin') && v.includes('user'))).toBe(true);
  });

  it('dialect override en désaccord avec les tables → throw', () => {
    const users = sqliteTable('users', { id: integer('id').primaryKey() });
    expect(() => inspectDrizzleSchema({ users }, 'postgresql')).toThrow(/does not match inferred/);
  });
});

Do **not** yet assert relation fields or m2m — Task 6.

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/drizzle/inspect.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `inspect.ts` (tables + dialect + scalar fields)**

Create `src/lib/server/adapters/drizzle/inspect.ts`. Use `extractTablesRelationalConfig` + `createTableRelationsHelpers` from `drizzle-orm` so table discovery matches drizzle's own walker. For this task, emit scalar fields only (skip building relation `Field`s and m2m — leave `m2m` as `new Map()`, and do not push `field.relation`).

Required pieces (write the full file, including empty relation/m2m stubs so Task 6 only fills them in — actually **YAGNI**: Task 6 will extend this file. For Task 5, implement scalars + dialect + `tables` map + `m2m: new Map()`).

```ts
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  is,
  Table
} from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { MySqlTable } from 'drizzle-orm/mysql-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Field, Model, Schema } from '../../types/schema.js';

export type DrizzleDialect = 'postgresql' | 'mysql' | 'sqlite';

export interface M2mLink {
  pivot: Table;
  selfColumn: Column;
  otherColumn: Column;
  selfKey: string;
  otherKey: string;
  targetTsName: string;
}

export interface InspectedDrizzleSchema {
  schema: Schema;
  tables: Record<string, Table>;
  m2m: Map<string, M2mLink>;
  dialect: DrizzleDialect;
}

function inferDialect(tables: Table[]): DrizzleDialect {
  const dialects = new Set<DrizzleDialect>();
  for (const t of tables) {
    if (is(t, PgTable)) dialects.add('postgresql');
    else if (is(t, MySqlTable)) dialects.add('mysql');
    else if (is(t, SQLiteTable)) dialects.add('sqlite');
  }
  if (dialects.size > 1) {
    throw new Error(
      '[sveltekit-admin] createDrizzleAdapter: mixed table dialects in schema (pgTable / mysqlTable / sqliteTable)'
    );
  }
  if (dialects.size === 0) return 'sqlite';
  return [...dialects][0]!;
}

export function mapColumnType(col: Column): { type: string; isEnum: boolean } {
  const enumValues = (col as Column & { enumValues?: string[] }).enumValues;
  if (enumValues && enumValues.length > 0) {
    return { type: col.columnType.replace(/^(Pg|MySql|SQLite)/, '') || 'String', isEnum: true };
  }
  const dt = col.dataType;
  const ct = col.columnType;
  if (dt === 'date' || /Timestamp/i.test(ct)) return { type: 'DateTime', isEnum: false };
  if (dt === 'boolean') return { type: 'Boolean', isEnum: false };
  if (dt === 'json') return { type: 'Json', isEnum: false };
  if (dt === 'bigint') return { type: 'BigInt', isEnum: false };
  if (dt === 'buffer') return { type: 'Bytes', isEnum: false };
  if (dt === 'string') return { type: 'String', isEnum: false };
  if (dt === 'number') {
    if (/Numeric|Decimal/i.test(ct)) return { type: 'Decimal', isEnum: false };
    if (/Real|Float|Double/i.test(ct)) return { type: 'Float', isEnum: false };
    return { type: 'Int', isEnum: false };
  }
  return { type: 'String', isEnum: false };
}

function timestampFlag(jsName: string, type: string): { isCreatedAt: boolean; isUpdatedAt: boolean } {
  if (type !== 'DateTime') return { isCreatedAt: false, isUpdatedAt: false };
  const n = jsName.toLowerCase().replace(/_/g, '');
  return {
    isCreatedAt: n === 'createdat',
    isUpdatedAt: n === 'updatedat'
  };
}

export function inspectDrizzleSchema(
  schemaObj: Record<string, unknown>,
  dialectOverride?: DrizzleDialect
): InspectedDrizzleSchema {
  const rawTables: Table[] = [];
  const tables: Record<string, Table> = {};
  for (const [key, value] of Object.entries(schemaObj)) {
    if (is(value, Table)) {
      rawTables.push(value);
      tables[key] = value;
    }
  }
  const inferred = inferDialect(rawTables);
  if (dialectOverride && rawTables.length > 0 && inferred !== dialectOverride) {
    throw new Error(
      `[sveltekit-admin] createDrizzleAdapter: dialect override '${dialectOverride}' does not match inferred '${inferred}'`
    );
  }
  const resolved = dialectOverride ?? inferred;

  const { tables: relTables } = extractTablesRelationalConfig(
    schemaObj,
    createTableRelationsHelpers
  );

  const enums = new Map<string, string[]>();
  const models: Model[] = [];

  for (const [tsName, cfg] of Object.entries(relTables)) {
    const fields: Field[] = [];
    for (const [jsName, col] of Object.entries(cfg.columns)) {
      const { type, isEnum } = mapColumnType(col as Column);
      if (isEnum) {
        const enumValues = (col as Column & { enumValues?: string[] }).enumValues ?? [];
        enums.set(type, enumValues);
      }
      const { isCreatedAt, isUpdatedAt } = timestampFlag(jsName, type);
      fields.push({
        name: jsName,
        type,
        isRequired: Boolean((col as Column).notNull),
        isList: false,
        isUnique: Boolean((col as Column & { isUnique?: boolean }).isUnique),
        isId: Boolean((col as Column).primary),
        isUpdatedAt,
        isCreatedAt,
        hasDefault: Boolean((col as Column).hasDefault),
        isEnum: isEnum || undefined
      });
    }
    models.push({ name: tsName, fields });
  }

  return {
    schema: { models, enums, provider: resolved },
    tables,
    m2m: new Map(),
    dialect: resolved
  };
}
```

Fix `isUnique`: drizzle columns expose uniqueness differently. If a public `isUnique` property is absent, leave `isUnique: false`. Do not invent a unique heuristic.

Import `extractTablesRelationalConfig` and `createTableRelationsHelpers` from `'drizzle-orm'`. If the installed version's types disagree, bump the *devDependency* to a 0.32+ release that exports them — do not add a fallback import path.

- [ ] **Step 5: Run tests, fix type mapping until they pass**

Run: `bunx vitest run tests/unit/adapters/drizzle/inspect.test.ts`

Expected: PASS. If `createdAt` with `integer(..., { mode: 'timestamp' })` does not map to `DateTime`, adjust `mapColumnType` to treat `dataType === 'date'` (drizzle's timestamp mode) as `DateTime` — already in the function. If the column's `dataType` is still `'number'`, also treat `/Timestamp/i.test(ct)` as `DateTime`.

If `isId` is false on autoincrement integer PK, read `(col as Column).primary` — drizzle sets this for `.primaryKey()`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/adapters/drizzle/inspect.ts tests/fixtures/drizzle/schema.ts tests/unit/adapters/drizzle/inspect.test.ts
git commit -m "$(cat <<'EOF'
feat: inspect Drizzle tables into the generic Schema lingua franca

EOF
)"
```

---

## Task 6: Drizzle inspect — `relations()` v1 + m2m synthesis

**Files:**
- Modify: `src/lib/server/adapters/drizzle/inspect.ts`
- Modify: `tests/unit/adapters/drizzle/inspect.test.ts`
- Test: `tests/unit/adapters/drizzle/inspect.test.ts`

**Interfaces:**
- Consumes: `One` / `Many` / `Relations` from `drizzle-orm`; `buildRelationGraph` from `introspection/relations.ts`.
- Produces: relation `Field`s on models. Pivot `postsToTags` → `isPivotTable: true`. Synthesized `posts.tags` and `tags.posts` (list, no `fields:`). `m2m` map keys `'posts.tags'` and `'tags.posts'`. No `posts.postsToTags` relation field when synthesis succeeds. Self-ref / name collision / missing `relations()` → no synthesis. `buildRelationGraph` classifies synthesized fields as `m2m`.

- [ ] **Step 1: Write the failing relation / m2m tests**

Append to `inspect.test.ts`:

```ts
import { buildRelationGraph } from '../../../../src/lib/server/introspection/relations.js';
import { relations } from 'drizzle-orm';

describe('inspectDrizzleSchema — relations v1 + m2m', () => {
  it('one({ fields }) → owning ; many(non-pivot) → inverse', () => {
    const { schema } = inspectDrizzleSchema(full);
    const posts = schema.models.find((m) => m.name === 'posts')!;
    const author = posts.fields.find((f) => f.name === 'author')!;
    expect(author.relation).toMatchObject({ model: 'users', fields: ['authorId'] });
    expect(author.isList).toBe(false);
    const users = schema.models.find((m) => m.name === 'users')!;
    const userPosts = users.fields.find((f) => f.name === 'posts')!;
    expect(userPosts.relation).toMatchObject({ model: 'posts' });
    expect(userPosts.isList).toBe(true);
    expect(userPosts.relation?.fields).toBeUndefined();
  });

  it('pivot pur → isPivotTable + m2m synthétisé nommé d\'après l\'export opposé', () => {
    const { schema, m2m } = inspectDrizzleSchema(full);
    const pivot = schema.models.find((m) => m.name === 'postsToTags')!;
    expect(pivot.isPivotTable).toBe(true);
    const posts = schema.models.find((m) => m.name === 'posts')!;
    expect(posts.fields.find((f) => f.name === 'postsToTags')).toBeUndefined();
    const tagsField = posts.fields.find((f) => f.name === 'tags')!;
    expect(tagsField.isList).toBe(true);
    expect(tagsField.relation).toMatchObject({ model: 'tags' });
    expect(tagsField.relation?.fields).toBeUndefined();
    const tags = schema.models.find((m) => m.name === 'tags')!;
    expect(tags.fields.find((f) => f.name === 'posts')?.relation).toMatchObject({ model: 'posts' });
    expect(m2m.has('posts.tags')).toBe(true);
    expect(m2m.has('tags.posts')).toBe(true);
    const graph = buildRelationGraph(schema);
    expect(graph.edges.get('posts.tags')?.kind).toBe('m2m');
    expect(graph.edges.get('tags.posts')?.kind).toBe('m2m');
    expect(graph.edges.get('posts.author')?.kind).toBe('to-one-owning');
  });

  it('sans relations() : scalaires seulement, pas d\'arête inventée depuis .references()', () => {
    const lone = sqliteTable('posts', {
      id: integer('id').primaryKey(),
      authorId: integer('author_id').notNull()
    });
    const { schema } = inspectDrizzleSchema({ posts: lone });
    const posts = schema.models.find((m) => m.name === 'posts')!;
    expect(posts.fields.every((f) => !f.relation)).toBe(true);
    expect(posts.fields.find((f) => f.name === 'author')).toBeUndefined();
    expect(posts.fields.find((f) => f.name === 'authorId')).toBeTruthy();
  });

  it('collision de nom : pas de synthèse m2m si le champ opposé existe déjà', () => {
    const a = sqliteTable('a', { id: integer('id').primaryKey() });
    const b = sqliteTable('b', {
      id: integer('id').primaryKey(),
      a: text('a') // JS key `a` collides with synthesized field named after model `a`
    });
    const pivot = sqliteTable('a_to_b', {
      aId: integer('a_id').notNull(),
      bId: integer('b_id').notNull()
    });
    const aRel = relations(a, ({ many }) => ({ a_to_b: many(pivot) }));
    const bRel = relations(b, ({ many }) => ({ a_to_b: many(pivot) }));
    const pRel = relations(pivot, ({ one }) => ({
      a: one(a, { fields: [pivot.aId], references: [a.id] }),
      b: one(b, { fields: [pivot.bId], references: [b.id] })
    }));
    const { schema, m2m } = inspectDrizzleSchema({ a, b, a_to_b: pivot, aRel, bRel, pRel });
    const modelB = schema.models.find((m) => m.name === 'b')!;
    expect(modelB.fields.find((f) => f.name === 'a' && f.relation?.model === 'a')).toBeUndefined();
    expect(m2m.size).toBe(0);
  });
});
```

Relations objects must be values in the schema object passed to `inspectDrizzleSchema`; their export keys are not models.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/drizzle/inspect.test.ts`

Expected: FAIL — no `author` relation field, `m2m` empty.

- [ ] **Step 3: Implement relation fields + pivot synthesis in `inspect.ts`**

After building scalar fields per table, walk `cfg.relations`:

- Import `One`, `Many` from `drizzle-orm`.
- `one` with `relation.config?.fields` → `Field` with `relation: { model: targetTsName, fields: jsNames, name: relation.relationName }`, `isList: false`.
- `one` without fields, or `many` → `Field` with `relation: { model: targetTsName, name: relation.relationName }`, `isList: is(relation, Many)`.
- Resolve `targetTsName` by identity: `Object.entries(tables).find(([, t]) => t === relation.referencedTable)?.[0]`.

Then detect pure pivots:

A table P is a pure pivot when:

1. Among its **relation** fields, there are exactly two `one({ fields })` pointing at distinct models A and B.
2. A and B each have a `many(P)` relation.
3. Business columns on P (not `isId`, not the two FK js names, not createdAt/updatedAt) length `<= 1`.

Then:

- set `isPivotTable: true` on P's Model
- if A does not already have a field named B's tsName and B does not already have a field named A's tsName, push synthesized list fields without `fields:` and record:

```ts
m2m.set(`${aTs}.${bTs}`, {
  pivot: pTable,
  selfColumn: aFkCol,
  otherColumn: bFkCol,
  selfKey: aFkJs,
  otherKey: bFkJs,
  targetTsName: bTs
});
m2m.set(`${bTs}.${aTs}`, {
  pivot: pTable,
  selfColumn: bFkCol,
  otherColumn: aFkCol,
  selfKey: bFkJs,
  otherKey: aFkJs,
  targetTsName: aTs
});
```
- omit the `many(P)` fields from A and B (do not push them)

Self-ref (A === B): skip synthesis (leave `many(P)` as to-many).

Name collision: skip synthesis, keep `many(P)`.

Column objects for `selfColumn` / `otherColumn`: the `one.config.fields[0]` columns on the pivot.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/unit/adapters/drizzle/inspect.test.ts tests/unit/relations.test.ts`

Expected: PASS. Existing `relations.test.ts` is Prisma-schema based and must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/drizzle/inspect.ts tests/unit/adapters/drizzle/inspect.test.ts
git commit -m "$(cat <<'EOF'
feat: map Drizzle relations() v1 and synthesize explicit m2m

EOF
)"
```

---

## Task 7: Drizzle filter compiler

**Files:**
- Create: `src/lib/server/adapters/drizzle/filterCompiler.ts`
- Create: `tests/unit/adapters/drizzle/filterCompiler.test.ts`
- Test: `tests/unit/adapters/drizzle/filterCompiler.test.ts`

**Interfaces:**
- Consumes: `Filter`, `isCompositeFilter`, `isLeafFilter`, a drizzle `Table`.
- Produces: `compileFilterToDrizzle(table, filter, opts: { caseInsensitiveSearch: boolean; dialect: DrizzleDialect }): SQL | undefined`. Throws on unknown field and on opaque nodes. `contains` → `ilike` only when `caseInsensitiveSearch && dialect === 'postgresql'`; otherwise `like`, or `lower(col) LIKE lower(pattern)` when ci is true on mysql/sqlite. `containsExact` → always `like`. `%` and `_` escaped in patterns.

- [ ] **Step 1: Write the failing compiler tests**

```ts
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { compileFilterToDrizzle } from '../../../../src/lib/server/adapters/drizzle/filterCompiler.js';

const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name'),
  tenantId: integer('tenant_id')
});

function sqlOf(
  filter: Parameters<typeof compileFilterToDrizzle>[1],
  opts: { caseInsensitiveSearch?: boolean; dialect?: 'postgresql' | 'mysql' | 'sqlite' } = {}
) {
  const db = drizzle(new Database(':memory:'));
  const where = compileFilterToDrizzle(users, filter, {
    caseInsensitiveSearch: opts.caseInsensitiveSearch ?? false,
    dialect: opts.dialect ?? 'sqlite'
  });
  return db.select().from(users).where(where).toSQL();
}

describe('compileFilterToDrizzle', () => {
  it('undefined → undefined', () => {
    expect(
      compileFilterToDrizzle(users, undefined, { caseInsensitiveSearch: false, dialect: 'sqlite' })
    ).toBeUndefined();
  });

  it('eq', () => {
    const { sql, params } = sqlOf({ op: 'eq', field: 'tenantId', value: 1 });
    expect(sql).toMatch(/tenant_id/);
    expect(params).toContain(1);
  });

  it('contains sensible → LIKE, jamais ILIKE', () => {
    const { sql, params } = sqlOf({ op: 'contains', field: 'name', value: 'Al' });
    expect(sql.toLowerCase()).toContain('like');
    expect(sql.toLowerCase()).not.toContain('ilike');
    expect(params.some((p) => String(p).includes('Al'))).toBe(true);
  });

  it('contains insensible sur sqlite : lower() des deux côtés, pas ilike', () => {
    const { sql } = sqlOf({ op: 'contains', field: 'name', value: 'Al' }, { caseInsensitiveSearch: true });
    expect(sql.toLowerCase()).toMatch(/lower/);
    expect(sql.toLowerCase()).not.toContain('ilike');
  });

  it('containsExact : LIKE, pas de fold même si ci=true', () => {
    const { sql } = sqlOf({ op: 'containsExact', field: 'name', value: 'Al' }, { caseInsensitiveSearch: true });
    expect(sql.toLowerCase()).toContain('like');
    expect(sql.toLowerCase()).not.toMatch(/ilike/);
  });

  it('échappe % et _ dans les patterns', () => {
    const { params } = sqlOf({ op: 'contains', field: 'name', value: 'a%b_c' });
    const pattern = params.find((p) => typeof p === 'string' && p.includes('a')) as string;
    expect(pattern).not.toBe('%a%b_c%');
    expect(pattern.includes('\\%') || pattern.includes('[%]')).toBe(true);
  });

  it('opaque Prisma where → throw (pas fail-open)', () => {
    expect(() =>
      compileFilterToDrizzle(users, { author: { is: { tenantId: 1 } } } as any, {
        caseInsensitiveSearch: false,
        dialect: 'sqlite'
      })
    ).toThrow(/nested Prisma `where` is not supported by the Drizzle adapter/);
  });

  it('champ inconnu → throw', () => {
    expect(() =>
      compileFilterToDrizzle(users, { op: 'eq', field: 'nope', value: 1 }, {
        caseInsensitiveSearch: false,
        dialect: 'sqlite'
      })
    ).toThrow(/unknown field/);
  });

  it('and / or / in / isNull / isNotNull / gte / startsWith', () => {
    expect(sqlOf({ op: 'and', clauses: [{ op: 'eq', field: 'id', value: 1 }, { op: 'eq', field: 'tenantId', value: 2 }] }).sql.toLowerCase()).toContain('and');
    expect(sqlOf({ op: 'or', clauses: [{ op: 'eq', field: 'id', value: 1 }, { op: 'eq', field: 'id', value: 2 }] }).sql.toLowerCase()).toContain('or');
    expect(sqlOf({ op: 'in', field: 'id', value: [1, 2] }).params).toEqual(expect.arrayContaining([1, 2]));
    expect(sqlOf({ op: 'isNull', field: 'name' }).sql.toLowerCase()).toMatch(/null/);
    expect(sqlOf({ op: 'gte', field: 'id', value: 3 }).sql.toLowerCase()).toMatch(/>=/);
    expect(sqlOf({ op: 'startsWith', field: 'name', value: 'A' }).params.some((p) => String(p).startsWith('A'))).toBe(true);
  });
});
```

When `caseInsensitiveSearch && dialect === 'postgresql'` → `ilike`. When `caseInsensitiveSearch && dialect !== 'postgresql'` → `lower(col) LIKE lower(pattern)`. When `!caseInsensitiveSearch` → `like`. Add one test that compiles `contains` against a `pgTable` with `{ caseInsensitiveSearch: true, dialect: 'postgresql' }` and asserts `sql.toLowerCase()` contains `ilike`, without executing against Postgres.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/drizzle/filterCompiler.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `filterCompiler.ts`**

Use `getTableColumns` (or `table` property access) to resolve `filter.field` → Column. Operators from `drizzle-orm`: `and`, `or`, `eq`, `like`, `ilike`, `inArray`, `isNull`, `isNotNull`, `gte`, `lte`, `lt`, `sql`. Escape `%` and `_` by replacing with `\%` `\_` and using `like(col, pattern, '\\')` if the drizzle `like` helper accepts an escape arg; if not, replace `%`/`_` with a documented escape and use `sql` fragments. Cover the escape branch in the test above.

Throw message for opaque nodes, verbatim:

`nested Prisma \`where\` is not supported by the Drizzle adapter; return a Filter or a flat \`{ field: scalar }\` map`

Unknown field: ``[sveltekit-admin] unknown field '${field}' on Drizzle table``.

Exhaustive `switch (filter.op)` on `LeafFilter` including `containsExact`. No `default` that swallows.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/unit/adapters/drizzle/filterCompiler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/drizzle/filterCompiler.ts tests/unit/adapters/drizzle/filterCompiler.test.ts
git commit -m "$(cat <<'EOF'
feat: compile Filter AST to drizzle SQL

EOF
)"
```

---

## Task 8: Drizzle `DataAdapter`

**Files:**
- Create: `src/lib/server/adapters/drizzle/dataAdapter.ts`
- Create: `tests/unit/adapters/drizzle/dataAdapter.test.ts`
- Test: `tests/unit/adapters/drizzle/dataAdapter.test.ts`

**Interfaces:**
- Consumes: `inspectDrizzleSchema` result (`tables`, `m2m`, `dialect`), `compileFilterToDrizzle`, `primaryKeyOf` / `coerceId` from `data.ts`, `DataAdapter`.
- Produces: `createDrizzleDataAdapter(db, ctx)` implementing every `DataAdapter` method. Scalar writes without transaction; m2m writes inside `db.transaction`. Update m2m = delete pivot rows for self id then insert (Prisma `set`). MySQL insert: no `.returning()` — insert then select by PK. sqlite/pg: `.returning()`.

- [ ] **Step 1: Write failing tests against in-memory sqlite**

Create `tests/unit/adapters/drizzle/dataAdapter.test.ts` that:

1. Opens `new Database(':memory:')`, `drizzle(sqlite)`, `CREATE TABLE` matching `tests/fixtures/drizzle/schema.ts` SQL names (`users`, `posts`, `tags`, `posts_to_tags`).
2. `const inspected = inspectDrizzleSchema(full)`
3. `const adapter = createDrizzleDataAdapter(db, { tables: inspected.tables, m2m: inspected.m2m, dialect: inspected.dialect, caseInsensitiveSearch: false })`
4. Uses `inspected.schema.models` to get `users` / `posts` / `tags` `Model`s.

Tests (each `it`):

- `listRecords` returns rows ordered by PK desc, honors skip/take, total matches count
- `listRecords` with `{ op: 'eq', field: 'tenantId', value: 1 }` filters
- `getRecord` / `findFirst` / `countRecords`
- `findMany` with `orderBy: { name: 'asc' }`
- `createRecord` scalars only (no `$transaction` needed)
- `updateRecord` / `deleteRecord`
- `createRecord` with `m2m: { tags: { targetPkField: 'id', ids: [1, 2] } }` inserts pivot rows
- `updateRecord` m2m `ids: [2]` replaces (set) — old pivot rows gone
- `updateRecord` m2m `ids: []` detaches all
- `getM2mSelectedIds` returns linked tag ids
- unknown `orderBy` key throws
- MySQL returning branch: pass `dialect: 'mysql'` and a **fake** `db` whose `insert().values()` has `$returningId` and **no working** `returning`, plus `select().from().where()`; assert the returned row comes from the follow-up select. Keep this fake small and local to one `it`.

DDL:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  tenant_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author_id INTEGER NOT NULL
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
CREATE TABLE posts_to_tags (
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id)
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/drizzle/dataAdapter.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `dataAdapter.ts`**

```ts
export function createDrizzleDataAdapter(
  db: any,
  ctx: {
    tables: Record<string, Table>;
    m2m: Map<string, M2mLink>;
    dialect: DrizzleDialect;
    caseInsensitiveSearch: boolean;
  }
): DataAdapter
```

Pattern for each method: `const table = ctx.tables[model.name]` — throw if missing. Compile filter with `compileFilterToDrizzle(table, filter, { caseInsensitiveSearch: ctx.caseInsensitiveSearch, dialect: ctx.dialect })`.

`listRecords`: `Promise.all` of `select().from(table).where(where).orderBy(desc(pkCol)).limit(take).offset(skip)` and `select({ n: count() }).from(table).where(where)`.

`getRecord`: `eq(pkCol, coerceId(String(id), model))`, limit 1, `rows[0] ?? null`.

m2m create (inside `db.transaction(async (tx) => …)`):

1. insert parent, get row (returning / mysql follow-up on `tx`)
2. for each m2m field, `ctx.m2m.get(\`${model.name}.${field}\`)` — if missing, skip
3. `tx.insert(link.pivot).values(ids.map(id => ({ [link.selfKey]: parentPk, [link.otherKey]: id })))`

Need JS keys of `selfColumn` / `otherColumn` — already on `M2mLink.selfKey` / `M2mLink.otherKey` from Task 6.

m2m update: update scalars, `tx.delete(pivot).where(eq(selfCol, id))`, then insert ids.

`getM2mSelectedIds`: if no map entry return `[]`; else `select({ id: otherCol }).from(pivot).where(eq(selfCol, coerceId(...)))` and map to values.

No new try/catch swallow except `getM2mSelectedIds` returning `[]` when the map entry is missing (spec). Do not catch query errors.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run tests/unit/adapters/drizzle/dataAdapter.test.ts tests/unit/adapters/drizzle/inspect.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/drizzle/dataAdapter.ts src/lib/server/adapters/drizzle/inspect.ts tests/unit/adapters/drizzle/dataAdapter.test.ts
git commit -m "$(cat <<'EOF'
feat: implement Drizzle DataAdapter with pivot m2m writes

EOF
)"
```

---

## Task 9: `createDrizzleAdapter` factory + subpath export

**Files:**
- Create: `src/lib/server/adapters/drizzle/introspector.ts`
- Create: `src/lib/server/adapters/drizzle/index.ts`
- Create: `tests/unit/adapters/drizzle/index.test.ts`
- Modify: `package.json` (`exports["./adapters/drizzle"]`)
- Modify: `tests/unit/index.test.ts` — still five runtime exports (must stay green)
- Test: `tests/unit/adapters/drizzle/index.test.ts`, `tests/unit/index.test.ts`

**Interfaces:**
- Consumes: `inspectDrizzleSchema`, `createDrizzleDataAdapter`.
- Produces:

```ts
export function createDrizzleAdapter(opts: {
  db: any;
  schema: Record<string, unknown>;
  dialect?: DrizzleDialect;
  searchMode?: 'auto' | 'insensitive' | 'default';
}): { introspector: SchemaIntrospector; data: DataAdapter }
```

`searchMode` default `'auto'` → `caseInsensitiveSearch` true iff dialect is `postgresql`. Introspect once, memoize `Schema` on the returned introspector (sync).

- [ ] **Step 1: Write the failing factory test**

```ts
import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { createDrizzleAdapter } from '../../../../src/lib/server/adapters/drizzle/index.js';
import * as schema from '../../../fixtures/drizzle/schema.js';

describe('createDrizzleAdapter', () => {
  it('compose introspector synchrone + data.listRecords', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT, tenant_id INTEGER NOT NULL, created_at INTEGER);`);
    sqlite.exec(`INSERT INTO users (email, name, tenant_id) VALUES ('a@x.y', 'A', 1);`);
    const db = drizzle(sqlite);
    const adapter = createDrizzleAdapter({ db, schema });
    const inspected = adapter.introspector.introspect();
    expect(inspected).not.toBeInstanceOf(Promise);
    const users = (inspected as Awaited<typeof inspected>).models.find((m) => m.name === 'users')!;
    const { rows, total } = await adapter.data.listRecords(users, { skip: 0, take: 20 });
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ email: 'a@x.y' });
  });

  it("searchMode 'insensitive' on sqlite still builds (compiler uses lower, not ilike)", () => {
    const db = drizzle(new Database(':memory:'));
    expect(() => createDrizzleAdapter({ db, schema, searchMode: 'insensitive' })).not.toThrow();
  });
});
```

Add to `tests/unit/adapters/drizzle/index.test.ts` (same file):

```ts
import { readFileSync } from 'node:fs';

it('package.json expose le sous-chemin ./adapters/drizzle', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
  expect(pkg.exports['./adapters/drizzle']).toMatchObject({
    types: './dist/server/adapters/drizzle/index.d.ts',
    default: './dist/server/adapters/drizzle/index.js'
  });
});
```

`import.meta.url` relative to the test file `tests/unit/adapters/drizzle/index.test.ts` → `../../../../package.json` is repo root. Confirm path: from `tests/unit/adapters/drizzle/` up 4 is repo root. Yes.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/drizzle/index.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement introspector + factory**

`introspector.ts`:

```ts
import type { SchemaIntrospector } from '../types.js';
import type { Schema } from '../../types/schema.js';

export function createDrizzleIntrospector(schema: Schema): SchemaIntrospector {
  return { introspect: () => schema };
}
```

`index.ts`:

```ts
import type { DataAdapter, SchemaIntrospector } from '../types.js';
import { inspectDrizzleSchema, type DrizzleDialect } from './inspect.js';
import { createDrizzleIntrospector } from './introspector.js';
import { createDrizzleDataAdapter } from './dataAdapter.js';

export type { DrizzleDialect };

function resolveCaseInsensitiveSearch(
  dialect: DrizzleDialect,
  searchMode: 'auto' | 'insensitive' | 'default' = 'auto'
): boolean {
  if (searchMode === 'insensitive') return true;
  if (searchMode === 'default') return false;
  return dialect === 'postgresql';
}

export function createDrizzleAdapter(opts: {
  db: any;
  schema: Record<string, unknown>;
  dialect?: DrizzleDialect;
  searchMode?: 'auto' | 'insensitive' | 'default';
}): { introspector: SchemaIntrospector; data: DataAdapter } {
  const inspected = inspectDrizzleSchema(opts.schema, opts.dialect);
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(inspected.dialect, opts.searchMode);
  return {
    introspector: createDrizzleIntrospector(inspected.schema),
    data: createDrizzleDataAdapter(opts.db, {
      tables: inspected.tables,
      m2m: inspected.m2m,
      dialect: inspected.dialect,
      caseInsensitiveSearch
    })
  };
}
```

- [ ] **Step 4: Add package.json export**

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "svelte": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./adapters/drizzle": {
    "types": "./dist/server/adapters/drizzle/index.d.ts",
    "svelte": "./dist/server/adapters/drizzle/index.js",
    "default": "./dist/server/adapters/drizzle/index.js"
  }
}
```

Do **not** add `createDrizzleAdapter` to `src/lib/index.ts`.

- [ ] **Step 5: Run tests**

Run: `bunx vitest run tests/unit/adapters/drizzle/index.test.ts tests/unit/index.test.ts`

Expected: PASS. Main entry still has exactly five runtime functions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/adapters/drizzle/index.ts src/lib/server/adapters/drizzle/introspector.ts package.json tests/unit/adapters/drizzle/index.test.ts
git commit -m "$(cat <<'EOF'
feat: export createDrizzleAdapter on sveltekit-admin/adapters/drizzle

EOF
)"
```

---

## Task 10: Handler integration against real SQLite + Drizzle

**Files:**
- Create: `tests/integration/handler.drizzle.db.test.ts`
- Do **not** modify `tests/integration/setup.ts` or `handler.db.test.ts`
- Test: `tests/integration/handler.drizzle.db.test.ts`

**Interfaces:**
- Consumes: `createAdminHandler`, `createDrizzleAdapter`, fixture schema.
- Produces: proof the handler list/create/update/delete, FK POST revalidation, m2m set/replace, flat `listWhere`, and nested `listWhere` throw all work on Drizzle.

- [ ] **Step 1: Write the integration test file**

Bootstrap in `beforeAll` / `beforeEach`:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createDrizzleAdapter } from '../../src/lib/server/adapters/drizzle/index.js';
import * as schema from '../fixtures/drizzle/schema.js';
import { createEvent } from '../fixtures/events.js';
```

- `const sqlite = new Database(':memory:')` once; run the four `CREATE TABLE` statements from Task 8.
- `const db = drizzle(sqlite)`
- `const handler = createAdminHandler({ adapter: createDrizzleAdapter({ db, schema }), authCheck: () => true })`
- Helper `call(url, body?)` copied from `handler.db.test.ts`.

`beforeEach`: `DELETE FROM posts_to_tags; DELETE FROM posts; DELETE FROM tags; DELETE FROM users;`

Tests:

1. Dashboard HTML contains the users/posts model labels (export keys run through `toLabel` → `Users`, `Posts`).
2. POST `/admin/users/new` `{ _action: 'create', email: 'a@x.y', name: 'Ada', tenantId: '1' }` → 303, row in sqlite.
3. List `/admin/users` shows Ada.
4. Update + delete by integer id.
5. Create a user, create a post with `authorId` of that user via form; forged `authorId` that does not exist → error path (invalid value). Use a real extra user in another tenant plus `models.posts.relations.author.where: () => ({ tenantId: 1 })` — wait: `where` on the **User** target fields. Flat `{ tenantId: 1 }` on author options. POST `authorId` of a user with `tenantId: 2` is rejected.
6. Tags + post m2m, same field names as `tests/integration/handler.m2m.db.test.ts`: POST `/admin/posts/new` with `_action=create`, `title=…`, `authorId=<userId>`, `__rel_present__tags=1`, `__rel__tags=<id1>,<id2>` (comma-separated). Assert `posts_to_tags` has two rows. Update with `__rel__tags=<id3>` only; assert replace (one row, id3).
7. `listWhere: () => ({ tenantId: 1 })` on `models.users` hides tenant 2 from `/admin/users`.
8. `listWhere: () => ({ author: { is: { tenantId: 1 } } })` on posts: listing throws / renders the handler error alert (Drizzle compiler throw). Do not fail-open (must not show all posts).

Auth: `authCheck: () => true` so tests aren't 401. If dashboard works without authCheck, omit it.

Model URL segments are `users` / `posts` / `tags` (export keys, lowercased already).

- [ ] **Step 2: Run the integration test**

Run: `bunx vitest run tests/integration/handler.drizzle.db.test.ts`

Expected: PASS once Task 8–9 are in. The synthesized m2m field on `posts` is `tags`; form fields are `authorId`, `__rel_present__tags`, `__rel__tags`.

- [ ] **Step 3: Confirm Prisma integration files are untouched**

Run: `git diff -- tests/characterization tests/integration/handler.db.test.ts tests/integration/handler.m2m.db.test.ts tests/integration/setup.ts`

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/handler.drizzle.db.test.ts
git commit -m "$(cat <<'EOF'
test: exercise the admin handler against a real Drizzle sqlite database

EOF
)"
```

---

## Task 11: README, changeset, full regression

**Files:**
- Modify: `README.md`
- Create: `.changeset/drizzle-adapter.md`
- Test: `bun run check`, `bun run lint`, `bun run test:coverage`, `bun run package`

**Interfaces:** none — verification + published docs.

- [ ] **Step 1: README snippet**

After the Prisma Quick Start block in `README.md`, add:

```markdown
## Drizzle

Prisma stays the default. For Drizzle, pass an adapter from the subpath
export (this does not pull in `drizzle-orm` for Prisma apps):

```typescript
import { createAdminHandler } from 'sveltekit-admin';
import { createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';

export const handle = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: (event) => event.locals.session?.user?.role === 'admin'
});
```

Pass the same `schema` object you already export (tables + `relations()`).
Model names in `config.models` are the JS export keys (`users`, not `User`).
`config.search.mode` only applies to `createAdminHandler({ prisma })`;
pass `searchMode` to `createDrizzleAdapter` instead. Nested Prisma `where`
objects in `listWhere` are not supported — use a flat `{ tenantId: 1 }` or
a `Filter` AST.
```

Do not rewrite the whole README to be ORM-agnostic beyond this section and a one-line Features bullet: `🔌 **Drizzle adapter** (optional subpath export)`.

- [ ] **Step 2: Changeset (minor — new export + new capability)**

Create `.changeset/drizzle-adapter.md`:

```md
---
"sveltekit-admin": minor
---

Add a **Drizzle** adapter, imported from `sveltekit-admin/adapters/drizzle` as `createDrizzleAdapter({ db, schema })`, with list/form/dashboard, relations, m2m, filters, and flat `listWhere` parity. `createAdminHandler({ prisma })` is unchanged; `@prisma/client` and `drizzle-orm` are optional peer dependencies so a Drizzle-only app no longer needs Prisma, and a Prisma-only app never has to install `drizzle-orm`.
```

- [ ] **Step 3: Full verification**

Run, in order:

```bash
bun run test:gen
bun run check
bun run lint
bun run test:coverage
bun run package
```

Expected: all PASS, coverage 100% on `src/lib/**` including every new drizzle file. `dist/server/adapters/drizzle/index.js` exists.

If coverage misses a dialect/`ilike`/mysql-returning/`isEnum` branch, add a focused unit test in the corresponding Task 5–8 file — do not lower thresholds.

- [ ] **Step 4: Characterization + Prisma integration still unmodified**

Run: `bunx vitest run tests/characterization/handler.snapshot.test.ts tests/integration/handler.db.test.ts tests/integration/handler.m2m.db.test.ts`

Expected: PASS.

Run: `git diff -- tests/characterization tests/integration/handler.db.test.ts tests/integration/handler.m2m.db.test.ts tests/integration/setup.ts`

Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add README.md .changeset/drizzle-adapter.md
git commit -m "$(cat <<'EOF'
docs: document the Drizzle adapter and add a minor changeset

EOF
)"
```

---

## Post-plan note (out of scope)

`defineRelations` v2 / `through:`, the docs site, `example/` Drizzle app, Kysely, and a `{ drizzle }` shorthand on `createAdminHandler` are follow-ups, not tasks here.
