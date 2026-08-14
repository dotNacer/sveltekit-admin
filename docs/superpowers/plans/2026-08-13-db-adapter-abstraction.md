# DbAdapter Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a generic `SchemaIntrospector`/`DataAdapter` abstraction so Prisma becomes one pluggable implementation (`createPrismaAdapter`) instead of being wired directly into `handler.ts`/`data.ts`, with zero observable behavior change — the ground-work for a future Drizzle adapter (separate spec, not implemented here).

**Architecture:** Two new interfaces live in `src/lib/server/adapters/types.ts`: `SchemaIntrospector` (boot-time, produces a generic `Schema`) and `DataAdapter` (per-request CRUD + relation reads, driven by a generic `Filter` AST instead of a raw Prisma `where` object). `src/lib/server/adapters/prisma/` implements both against the real Prisma client. `createAdminHandler` builds a `createPrismaAdapter(...)` internally when called with the legacy `{ prisma, prismaSchemaPath }` config, or uses `config.adapter` directly if provided — both paths converge on the same `{ introspector, data }` shape before any other handler logic runs.

**Tech Stack:** TypeScript, Vitest, the existing hand-rolled `prismaMock.ts` (gains one method: `$transaction`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-13-db-adapter-abstraction-design.md`

## Global Constraints

- **Zero breaking change**: `createAdminHandler({ prisma, prismaSchemaPath, ... })` must keep working byte-for-byte as today. `PrismaSchema`/`PrismaModel`/`PrismaField` stay exported with the exact same shape.
- **100% coverage, no exceptions**: `vitest.config.ts` enforces lines/statements/functions/branches at 100% on `src/lib/**`. No `exclude`, no `v8 ignore`. Every new branch needs a real test.
- **Never spread a Prisma/Filter `where`/scope composition** — always compose via `AND` (array), consistent with the existing anti-IDOR invariant in `listQuery.ts`.
- **`tests/characterization/handler.snapshot.test.ts` and `tests/integration/handler.db.test.ts` (real SQLite via `prisma db push`) must pass unmodified** at the end of every task from Task 5 onward — that's the regression safety net proving behavior didn't change.
- Run `bun run test:gen` once before running any test command in a fresh shell (regenerates the Prisma client the test suite depends on into `tests/fixtures/prisma/client/`, gitignored).
- Package manager is **bun**. Use `bunx vitest run <path>` for single-file runs, `bun run test` for the full suite, `bun run check` for type-checking, `bun run lint` for eslint.

---

## Task 1: Generic Schema types + backward-compatible public aliases

**Files:**
- Create: `src/lib/server/types/schema.ts`
- Modify: `src/lib/server/introspection/parser.ts:8-49` (replace the three `export interface` declarations with re-exported aliases)
- Modify: `src/lib/index.ts`
- Modify: `tests/unit/index.test.ts`
- Test: `tests/unit/index.test.ts` (extended), existing `tests/unit/parser.test.ts` (must pass unmodified)

**Interfaces:**
- Produces: `Schema`, `Model`, `Field` (from `src/lib/server/types/schema.ts`) — the canonical generic shapes every later task imports instead of `PrismaSchema`/`PrismaModel`/`PrismaField`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/index.test.ts`, replacing the `TYPE_ONLY_EXPORTS` array:

```ts
const TYPE_ONLY_EXPORTS = [
  'AdminHandlerConfig',
  'PrismaSchema',
  'PrismaModel',
  'PrismaField',
  'Schema',
  'Model',
  'Field'
] as const;
```

(The rest of the file — `RUNTIME_EXPORTS`, the `describe` block — stays as-is; `it.each(TYPE_ONLY_EXPORTS)` already asserts `name in api === false` for every entry, so this alone is the new assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/index.test.ts -t "n’émet aucune valeur pour le type"`
Expected: PASS already, trivially — `Schema`/`Model`/`Field` don't exist yet anywhere, so `'Schema' in api` is `false` regardless. This step is a no-op gate; the real verification for this task is the type-level one in Step 6 (`bun run check`). Proceed.

- [ ] **Step 3: Create the generic types**

Create `src/lib/server/types/schema.ts`:

```ts
/**
 * Generic schema shapes shared by every schema-source adapter (Prisma today,
 * others later). Deliberately identical in shape to what `introspection/
 * parser.ts` has always produced — this file is a rename of that shape, not
 * a redesign of it. `PrismaSchema`/`PrismaModel`/`PrismaField` in parser.ts
 * become aliases of these.
 */

export interface Field {
  name: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  isUpdatedAt: boolean;
  isCreatedAt: boolean;
  hasDefault: boolean;
  defaultValue?: string;
  /** true si `type` correspond à un `enum` déclaré dans le même schéma. */
  isEnum?: boolean;
  relation?: {
    name?: string;
    model: string;
    fields?: string[];
    references?: string[];
  };
  documentation?: string;
}

export interface Model {
  name: string;
  fields: Field[];
  documentation?: string;
  primaryKey?: string;
  isPivotTable?: boolean;
}

export interface Schema {
  models: Model[];
  enums: Map<string, string[]>;
  provider?: string;
}
```

- [ ] **Step 4: Point `parser.ts` at the generic types**

In `src/lib/server/introspection/parser.ts`, replace lines 8-49 (the `PrismaField`, `PrismaModel`, `PrismaSchema` interface declarations, including their doc comments) with:

```ts
import type { Field, Model, Schema } from '../types/schema.js';

export type PrismaField = Field;
export type PrismaModel = Model;
export type PrismaSchema = Schema;
```

Everything below (the `SCALAR_TYPES` constant, `detectPivotTable`, `parsePrismaSchema`, `parseSchemaContent`, `parseModelFields`, `parseFieldLine`, `isSensitiveFieldName`, `getDisplayFields`) stays untouched — it already builds and returns object literals matching this shape, so nothing about the parsing logic changes.

- [ ] **Step 5: Export the generic types publicly**

In `src/lib/index.ts`, add one export block:

```ts
export type { Schema, Model, Field } from './server/types/schema.js';
```

Full resulting file:

```ts
/**
 * SvelteKit Admin
 * Django-like admin panel for SvelteKit + Prisma
 */

export { createAdminHandler, type AdminHandlerConfig } from './server/handler.js';
export { defaultAdminCheck } from './server/auth.js';
export {
  parsePrismaSchema,
  parseSchemaContent,
  type PrismaSchema,
  type PrismaModel,
  type PrismaField
} from './server/introspection/parser.js';
export type { Schema, Model, Field } from './server/types/schema.js';
```

- [ ] **Step 6: Run the full check + test suite**

Run: `bun run check`
Expected: PASS, no type errors (the alias types are structurally identical to what they replace).

Run: `bun run test`
Expected: PASS. `tests/unit/parser.test.ts` and every other existing test imports `PrismaField`/`PrismaModel`/`PrismaSchema` by name and gets the exact same shape — no assertion changes needed there. `tests/unit/index.test.ts` passes with the extended `TYPE_ONLY_EXPORTS` list.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/types/schema.ts src/lib/server/introspection/parser.ts src/lib/index.ts tests/unit/index.test.ts
git commit -m "refactor: extract generic Schema/Model/Field types, keep Prisma* as aliases"
```

---

## Task 2: Generic `Filter` AST + Prisma filter compiler

**Files:**
- Create: `src/lib/server/adapters/types.ts` (only the `Filter` type for now — `SchemaIntrospector`/`DataAdapter` are added in Task 3)
- Create: `src/lib/server/adapters/prisma/filterCompiler.ts`
- Create: `tests/unit/adapters/prisma/filterCompiler.test.ts`
- Modify: `src/lib/server/query/listQuery.ts` (`buildWhere` and its two helpers change return shape)
- Modify: `src/lib/server/handler.ts:858-859` (insert the compile step)
- Modify: `tests/unit/listQuery.test.ts` (the `buildWhere` describe block's assertions change from Prisma-where shape to `Filter` shape)

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `Filter` (exported from `src/lib/server/adapters/types.ts`) — every later task that builds or compiles a where-clause imports this. `buildWhere(query, scope, caseInsensitiveSearch, model): Filter | undefined` (same signature, new return type). `compileFilterToPrismaWhere(filter: Filter | undefined): Record<string, unknown> | undefined` (from `filterCompiler.ts`) — the only place that still knows Prisma's `AND`/`OR`/`contains`/`mode: 'insensitive'` vocabulary.

- [ ] **Step 1: Write the failing test for the `Filter` shape**

Replace the entire `describe('buildWhere — composition AND, jamais de spread', ...)` block in `tests/unit/listQuery.test.ts` (currently lines 445-626) with assertions on the new `Filter` shape. `Filter` is a discriminated union: composite nodes carry `{ op: 'and' | 'or', clauses: Filter[] }`, leaf nodes carry `{ op: <leaf-op>, field, value? }`. A single active clause with no scope returns the bare leaf node (not wrapped in `and`), mirroring today's "no `AND` wrapper for a single Prisma where key" behavior:

```ts
describe('buildWhere — composition AND, jamais de spread (Filter générique)', () => {
  const empty: ListQuery = { q: null, searchFields: [], filters: [], ignored: [] };

  it('undefined quand rien n\'est actif (identique au comportement actuel)', () => {
    expect(buildWhere(empty, undefined, false, Article)).toBeUndefined();
  });

  it('le scope seul, sans wrapper and, quand aucun filtre n\'est actif', () => {
    expect(buildWhere(empty, { tenantId: 1 }, false, Article)).toEqual({ tenantId: 1 });
  });

  it('un seul filtre actif sans scope : la clause brute, sans wrapper and', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'views', op: 'equals', value: 5, raw: '5' }], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({ op: 'eq', field: 'views', value: 5 });
  });

  it('scope + filtre → and explicite, scope en premier', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'views', op: 'equals', value: 5, raw: '5' }], ignored: [] };
    expect(buildWhere(lq, { tenantId: 1 }, false, Article)).toEqual({
      op: 'and',
      clauses: [{ tenantId: 1 }, { op: 'eq', field: 'views', value: 5 }]
    });
  });

  it('un filtre sur le MÊME champ que le scope ne l\'écrase jamais (and, pas de spread)', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'tenantId', op: 'equals', value: 2, raw: '2' }], ignored: [] };
    const where = buildWhere(lq, { tenantId: 1 }, false, Article);
    expect(where).toEqual({
      op: 'and',
      clauses: [{ tenantId: 1 }, { op: 'eq', field: 'tenantId', value: 2 }]
    });
  });

  it('deux filtres sur le même champ (gte + lte) donnent deux clauses and, pas un merge', () => {
    const lq: ListQuery = {
      q: null, searchFields: [], ignored: [],
      filters: [
        { field: 'views', op: 'gte', value: 10, raw: '10' },
        { field: 'views', op: 'lte', value: 100, raw: '100' }
      ]
    };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({
      op: 'and',
      clauses: [
        { op: 'gte', field: 'views', value: 10 },
        { op: 'lte', field: 'views', value: 100 }
      ]
    });
  });

  it('isnull=true → isNull', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'content', op: 'isnull', value: true, raw: '1' }], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({ op: 'isNull', field: 'content' });
  });

  it('isnull=false → isNotNull', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'content', op: 'isnull', value: false, raw: '0' }], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({ op: 'isNotNull', field: 'content' });
  });

  it('recherche texte → or sur les searchFields (String non-id, y compris @unique → contains)', () => {
    const lq: ListQuery = { q: 'hello', searchFields: ['title', 'slug'], filters: [], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({
      op: 'or',
      clauses: [
        { op: 'contains', field: 'title', value: 'hello' },
        { op: 'contains', field: 'slug', value: 'hello' }
      ]
    });
  });

  it('recherche texte avec mode insensible à la casse : le Filter générique ne porte pas ce détail (c\'est le compilateur Prisma qui l\'ajoute — voir filterCompiler.test.ts)', () => {
    const lq: ListQuery = { q: 'hello', searchFields: ['title'], filters: [], ignored: [] };
    // caseInsensitiveSearch n'affecte plus la forme du Filter lui-même : le
    // Filter générique est le même que sensible à la casse ou pas, le
    // compilateur Prisma décide seul d'ajouter `mode: 'insensitive'`.
    expect(buildWhere(lq, undefined, true, Article)).toEqual(buildWhere(lq, undefined, false, Article));
  });

  it('q présent mais searchFields vide → aucune clause de recherche (no-op)', () => {
    const lq: ListQuery = { q: 'hello', searchFields: [], filters: [], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toBeUndefined();
  });

  it('recherche + filtre + scope ensemble → un seul and cohérent', () => {
    const lq: ListQuery = {
      q: 'hello', searchFields: ['title'],
      filters: [{ field: 'published', op: 'equals', value: true, raw: 'true' }],
      ignored: []
    };
    const where = buildWhere(lq, { tenantId: 1 }, false, Article);
    expect(where).toEqual({
      op: 'and',
      clauses: [
        { tenantId: 1 },
        { op: 'eq', field: 'published', value: true },
        { op: 'or', clauses: [{ op: 'contains', field: 'title', value: 'hello' }] }
      ]
    });
  });

  describe('§2.4 — searchFields sur un champ non-String (jamais de contains)', () => {
    it('champ Int configuré explicitement, q coercible → eq, jamais contains', () => {
      const lq: ListQuery = { q: '10', searchFields: ['views'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toEqual({
        op: 'or', clauses: [{ op: 'eq', field: 'views', value: 10 }]
      });
    });

    it('champ Int configuré, q non coercible ("hello") → clause omise', () => {
      const lq: ListQuery = { q: 'hello', searchFields: ['views'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toBeUndefined();
    });

    it('champ Decimal configuré, q coercible → eq en string', () => {
      const lq: ListQuery = { q: '19.99', searchFields: ['price'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toEqual({
        op: 'or', clauses: [{ op: 'eq', field: 'price', value: '19.99' }]
      });
    });

    it('mélange String + Int dans searchFields : seules les clauses valides entrent dans le or', () => {
      const lq: ListQuery = { q: 'hello', searchFields: ['title', 'views'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toEqual({
        op: 'or', clauses: [{ op: 'contains', field: 'title', value: 'hello' }]
      });
    });

    it('toutes les clauses omises → no-op', () => {
      const lq: ListQuery = { q: 'not-a-number', searchFields: ['views', 'price'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toBeUndefined();
    });

    it('un champ String @id configuré explicitement → eq, jamais contains', () => {
      const idSchema = parseSchemaContent(
        'model T {\n  id String @id @default(cuid())\n  slug String @unique\n  name String\n}'
      );
      const T = idSchema.models[0];
      const lq: ListQuery = { q: 'abc123', searchFields: ['id', 'slug'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, T)).toEqual({
        op: 'or',
        clauses: [
          { op: 'eq', field: 'id', value: 'abc123' },
          { op: 'contains', field: 'slug', value: 'abc123' }
        ]
      });
    });

    it('un champ Boolean ou DateTime configuré explicitement → clause omise', () => {
      const lq: ListQuery = { q: 'hello', searchFields: ['published', 'createdAt'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toBeUndefined();
    });

    it('un nom de champ absent du modèle : clause omise, pas de throw', () => {
      const lq: ListQuery = { q: 'hello', searchFields: ['doesNotExist', 'title'], filters: [], ignored: [] };
      expect(buildWhere(lq, undefined, false, Article)).toEqual({
        op: 'or', clauses: [{ op: 'contains', field: 'title', value: 'hello' }]
      });
    });
  });

  it('date shortcut (gte/lt) se traduit en deux clauses and via buildWhere', () => {
    const range = resolveDateShortcut('today', FIXED_NOW)!;
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'createdAt', op: 'gte', value: range, raw: 'today' }], ignored: [] };
    expect(buildWhere(lq, undefined, false, Article)).toEqual({
      op: 'and',
      clauses: [
        { op: 'gte', field: 'createdAt', value: range.gte },
        { op: 'lt', field: 'createdAt', value: range.lt }
      ]
    });
  });
});
```

Note the date-shortcut case now produces TWO `and`-ed leaf clauses (`gte` + `lt`) instead of one leaf carrying both bounds — `Filter`'s leaf shape only has one `value`, so the two-bound date-range case must become two clauses. This is the one intentional shape difference from today's `{ field: { gte, lt } }` object; `filterCompiler.ts` (Step 3) re-merges them back into that exact Prisma shape, so the final Prisma `where` sent to the database is unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/listQuery.test.ts`
Expected: FAIL — `buildWhere` still returns the old Prisma-shaped object, every rewritten assertion mismatches.

- [ ] **Step 3: Define the `Filter` type**

Create `src/lib/server/adapters/types.ts`:

```ts
/**
 * ORM-agnostic where-clause AST. `listQuery.ts#buildWhere` produces this;
 * each adapter's own `filterCompiler` (see `adapters/prisma/filterCompiler.ts`)
 * turns it into that ORM's native query shape. Never expose an ORM-specific
 * operator here (no `mode: 'insensitive'`, no Prisma `not`) — those are
 * compiler-side decisions made from `LeafFilter.op`, not carried in the AST.
 */
export type Filter = CompositeFilter | LeafFilter;

export interface CompositeFilter {
  op: 'and' | 'or';
  clauses: Filter[];
}

export interface LeafFilter {
  op: 'eq' | 'contains' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull';
  field: string;
  value?: unknown;
}
```

- [ ] **Step 4: Rewrite `buildWhere` and its helpers to produce `Filter`**

In `src/lib/server/query/listQuery.ts`:

1. Add the import at the top (after the existing `parser.js` import):

```ts
import type { Filter } from '../adapters/types.js';
```

2. Replace lines 416-471 (`export type PrismaWhere = ...` through the end of `buildWhere`) with:

```ts
function clauseOf(filter: ActiveFilter): Filter[] {
  if (filter.op === 'gte' && filter.value && typeof filter.value === 'object' && 'gte' in (filter.value as object)) {
    // Date shortcut carrying both bounds (see parseOneFilter's DateTime branch) —
    // becomes two leaf clauses, re-merged by the Prisma filterCompiler.
    const range = filter.value as DateRange;
    return [
      { op: 'gte', field: filter.field, value: range.gte },
      { op: 'lt', field: filter.field, value: range.lt }
    ];
  }
  if (filter.op === 'isnull') {
    return [{ op: filter.value ? 'isNull' : 'isNotNull', field: filter.field }];
  }
  if (filter.op === 'equals') {
    return [{ op: 'eq', field: filter.field, value: filter.value }];
  }
  return [{ op: filter.op, field: filter.field, value: filter.value } as Filter];
}

/**
 * Compose the final generic `Filter`: `and: [scope, ...filters, {or: search}]`.
 * NEVER a spread — see clauseOf's callers and docs/design §0.c history. `scope`
 * stays a raw Prisma-shaped object here (it's an escape hatch supplied by the
 * consuming app's own `listWhere`/`relations[x].where` config, itself already
 * Prisma-shaped and unchanged by this refactor) — it's treated as an opaque
 * leaf and passed through `and`/`or` untouched, exactly like today.
 *
 * Returns `undefined` when nothing is active, so a caller with no filter and
 * no scope sees the exact same "no where clause at all" behavior as today.
 */
export function buildWhere(
  query: ListQuery,
  scope: Record<string, unknown> | undefined,
  caseInsensitiveSearch: boolean,
  model: PrismaModel
): Filter | Record<string, unknown> | undefined {
  const and: (Filter | Record<string, unknown>)[] = [];
  if (scope) and.push(scope);
  for (const f of query.filters) and.push(...clauseOf(f));

  if (query.q && query.searchFields.length > 0) {
    const or: Filter[] = [];
    for (const fieldName of query.searchFields) {
      const field = model.fields.find((f) => f.name === fieldName);
      const clause = searchClauseFor(field, fieldName, query.q);
      if (clause) or.push(clause);
    }
    // Never emit `{op: 'or', clauses: []}` — see the historical Prisma
    // `{OR: []}`-matches-nothing bug this guards against.
    if (or.length > 0) and.push({ op: 'or', clauses: or });
  }

  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0];
  return { op: 'and', clauses: and } as Filter;
}

/**
 * The per-field-type clause for a `searchFields` entry (§2.4) — same rules as
 * before (String @id -> eq, other String -> contains, numeric -> eq if
 * coercible else omitted, anything else omitted). `caseInsensitiveSearch` no
 * longer lives here: the generic `Filter` doesn't carry a case-sensitivity
 * flag, `filterCompiler.ts` decides whether to add `mode: 'insensitive'` from
 * the same boolean at the handler.ts call site instead.
 */
function searchClauseFor(
  field: PrismaField | undefined,
  fieldName: string,
  q: string
): Filter | undefined {
  if (!field) return undefined;

  if (field.type === 'String') {
    return field.isId ? { op: 'eq', field: fieldName, value: q } : { op: 'contains', field: fieldName, value: q };
  }

  if (['Int', 'BigInt', 'Float', 'Decimal'].includes(field.type)) {
    const coerced = coerceValue(field, 'equals', q);
    return coerced === undefined ? undefined : { op: 'eq', field: fieldName, value: coerced };
  }

  return undefined;
}
```

Note `buildWhere`'s `scope` parameter stays a raw `Record<string, unknown>` (Prisma-shaped) rather than becoming a `Filter` — this is deliberate and unchanged from today: `listWhere`/`relations[x].where` are public config functions returning a Prisma `where` fragment directly (`AdminHandlerConfig.models[].listWhere`), and changing their shape would be the exact breaking change this spec rules out. It's carried through `and`/`or` as an opaque object, same as `caseInsensitiveSearch`'s removal from the AST — both are Prisma-specific escape hatches that stay Prisma-specific.

The `caseInsensitiveSearch` parameter to `buildWhere` is now unused (kept in the signature only for call-site backward compatibility at this step — Task 2 doesn't touch call sites beyond the one in handler.ts, which still passes it positionally). Confirm the linter doesn't flag it as unused-but-required: TypeScript allows an unused parameter that isn't the last one when later parameters are used; here it's the third of four positional params (`query, scope, caseInsensitiveSearch, model`) so no `noUnusedParameters` warning fires. Leave it in place; `filterCompiler.ts` (Step 5) is where it's actually consumed now.

- [ ] **Step 5: Write the Prisma filter compiler**

Create `src/lib/server/adapters/prisma/filterCompiler.ts`:

```ts
/**
 * Compiles the generic `Filter` AST (see ../types.ts) into a Prisma `where`
 * object. This is the ONLY place in the Prisma adapter that knows Prisma's
 * where-clause vocabulary (`AND`/`OR`/`contains`/`startsWith`/`gte`/`lte`/
 * `equals`/`not`/`in`/`mode: 'insensitive'`) — moved here unchanged from the
 * former end of `query/listQuery.ts#buildWhere`.
 */
import type { Filter } from '../types.js';

export type PrismaWhere = Record<string, unknown>;

function compileLeaf(filter: Filter, caseInsensitiveSearch: boolean): PrismaWhere {
  if (filter.op === 'and' || filter.op === 'or') {
    throw new Error('compileLeaf called on a composite filter');
  }
  switch (filter.op) {
    case 'eq':
      return { [filter.field]: filter.value };
    case 'contains':
      return caseInsensitiveSearch
        ? { [filter.field]: { contains: filter.value, mode: 'insensitive' } }
        : { [filter.field]: { contains: filter.value } };
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

/**
 * `scope`/opaque Prisma fragments composed by `buildWhere` alongside `Filter`
 * nodes flow straight through here as plain objects — `and`/`or` are the only
 * two shapes `buildWhere` ever nests a raw object inside, so a non-`Filter`
 * entry inside a `clauses` array is always one of those two escape hatches,
 * never a third node type to guard against.
 */
function compile(node: Filter | PrismaWhere, caseInsensitiveSearch: boolean): PrismaWhere {
  if ('op' in node && (node.op === 'and' || node.op === 'or')) {
    const clauses = node.clauses.map((c) => compile(c, caseInsensitiveSearch));
    return node.op === 'and' ? { AND: clauses } : { OR: clauses };
  }
  if ('op' in node) {
    return compileLeaf(node as Filter, caseInsensitiveSearch);
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

- [ ] **Step 6: Wire the compile step into `handler.ts`**

In `src/lib/server/handler.ts`, add the import (near the other `listQuery.js` import, around line 22-26):

```ts
import {
  parseListQuery,
  buildWhere,
  resolveSearchFields
} from './query/listQuery.js';
import { compileFilterToPrismaWhere } from './adapters/prisma/filterCompiler.js';
```

Replace line 858 (`const where = buildWhere(listQuery, listScope, caseInsensitiveSearch, model);`) with:

```ts
const filter = buildWhere(listQuery, listScope, caseInsensitiveSearch, model);
const where = compileFilterToPrismaWhere(filter, caseInsensitiveSearch);
```

Line 859 (`const { items, total } = await listRecords(prisma, model, page, PER_PAGE, where);`) stays as-is for now — `listRecords` still takes a raw Prisma `where`, and `where` is still exactly that shape after compilation. This task does not touch how `listRecords` is called, only what flows into it.

- [ ] **Step 7: Write the filter compiler's own tests**

Create `tests/unit/adapters/prisma/filterCompiler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compileFilterToPrismaWhere } from '../../../../src/lib/server/adapters/prisma/filterCompiler.js';

describe('compileFilterToPrismaWhere', () => {
  it('undefined → undefined', () => {
    expect(compileFilterToPrismaWhere(undefined, false)).toBeUndefined();
  });

  it('leaf eq', () => {
    expect(compileFilterToPrismaWhere({ op: 'eq', field: 'views', value: 5 }, false)).toEqual({ views: 5 });
  });

  it('leaf contains, sensible à la casse', () => {
    expect(compileFilterToPrismaWhere({ op: 'contains', field: 'title', value: 'x' }, false)).toEqual({
      title: { contains: 'x' }
    });
  });

  it('leaf contains, insensible à la casse (mode Prisma)', () => {
    expect(compileFilterToPrismaWhere({ op: 'contains', field: 'title', value: 'x' }, true)).toEqual({
      title: { contains: 'x', mode: 'insensitive' }
    });
  });

  it('leaf startsWith', () => {
    expect(compileFilterToPrismaWhere({ op: 'startsWith', field: 'title', value: 'x' }, false)).toEqual({
      title: { startsWith: 'x' }
    });
  });

  it.each(['gte', 'lte', 'lt'] as const)('leaf %s', (op) => {
    expect(compileFilterToPrismaWhere({ op, field: 'views', value: 5 }, false)).toEqual({
      views: { [op]: 5 }
    });
  });

  it('leaf in', () => {
    expect(compileFilterToPrismaWhere({ op: 'in', field: 'id', value: [1, 2] }, false)).toEqual({
      id: { in: [1, 2] }
    });
  });

  it('leaf isNull → {equals: null}', () => {
    expect(compileFilterToPrismaWhere({ op: 'isNull', field: 'content' }, false)).toEqual({
      content: { equals: null }
    });
  });

  it('leaf isNotNull → {not: null}', () => {
    expect(compileFilterToPrismaWhere({ op: 'isNotNull', field: 'content' }, false)).toEqual({
      content: { not: null }
    });
  });

  it('composite and, avec un scope brut mêlé à des leaves', () => {
    const compiled = compileFilterToPrismaWhere(
      { op: 'and', clauses: [{ tenantId: 1 }, { op: 'eq', field: 'views', value: 5 }] },
      false
    );
    expect(compiled).toEqual({ AND: [{ tenantId: 1 }, { views: 5 }] });
  });

  it('composite or', () => {
    const compiled = compileFilterToPrismaWhere(
      { op: 'or', clauses: [{ op: 'contains', field: 'title', value: 'a' }, { op: 'contains', field: 'slug', value: 'a' }] },
      false
    );
    expect(compiled).toEqual({ OR: [{ title: { contains: 'a' } }, { slug: { contains: 'a' } }] });
  });

  it('and imbriqué dans or', () => {
    const compiled = compileFilterToPrismaWhere(
      {
        op: 'or',
        clauses: [{ op: 'and', clauses: [{ op: 'gte', field: 'views', value: 1 }, { op: 'lt', field: 'views', value: 10 }] }]
      },
      false
    );
    expect(compiled).toEqual({ OR: [{ AND: [{ views: { gte: 1 } }, { views: { lt: 10 } }] }] });
  });

  it('un scope brut seul (pas de wrapper) passe tel quel', () => {
    expect(compileFilterToPrismaWhere({ tenantId: 1 }, false)).toEqual({ tenantId: 1 });
  });
});
```

- [ ] **Step 8: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/listQuery.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts`
Expected: PASS.

Run: `bun run test`
Expected: PASS in full (the handler.ts list-view path now round-trips `buildWhere` → `compileFilterToPrismaWhere` → the exact same Prisma `where` object as before, so every existing handler/characterization/integration test that exercises the list view keeps passing unmodified).

Run: `bun run test:coverage`
Expected: 100% on the new files and on the modified `listQuery.ts` (every `Filter` op has a dedicated test in Step 7 above; every `buildWhere` branch already had coverage from the pre-existing suite, now re-pointed at the new shape in Step 1).

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/adapters/types.ts src/lib/server/adapters/prisma/filterCompiler.ts \
        src/lib/server/query/listQuery.ts src/lib/server/handler.ts \
        tests/unit/listQuery.test.ts tests/unit/adapters/prisma/filterCompiler.test.ts
git commit -m "refactor: buildWhere produces a generic Filter AST, compiled to Prisma where by a new filterCompiler"
```

---

## Task 3: `SchemaIntrospector`/`DataAdapter` interfaces + Prisma introspector

**Files:**
- Modify: `src/lib/server/adapters/types.ts` (add `SchemaIntrospector`, `DataAdapter`)
- Create: `src/lib/server/adapters/prisma/introspector.ts`
- Create: `tests/unit/adapters/prisma/introspector.test.ts`

**Interfaces:**
- Consumes: `Schema`/`Model` (Task 1), `Filter` (Task 2).
- Produces: `SchemaIntrospector`, `DataAdapter`, `RelationEdge` re-export (from `adapters/types.ts`) — Task 4 implements `DataAdapter`; Task 5 consumes both interfaces from `handler.ts`. `createPrismaIntrospector({ schemaPath }): SchemaIntrospector`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/adapters/prisma/introspector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPrismaIntrospector } from '../../../../src/lib/server/adapters/prisma/introspector.js';
import { parsePrismaSchema } from '../../../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH, MALFORMED_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

describe('createPrismaIntrospector', () => {
  it('introspect() renvoie exactement ce que produirait parsePrismaSchema directement', () => {
    const introspector = createPrismaIntrospector({ schemaPath: FULL_SCHEMA_PATH });
    expect(introspector.introspect()).toEqual(parsePrismaSchema(FULL_SCHEMA_PATH));
  });

  it('propage une erreur de parsing (fichier absent) au lieu de l\'avaler', () => {
    const introspector = createPrismaIntrospector({ schemaPath: '/does/not/exist.prisma' });
    expect(() => introspector.introspect()).toThrow();
  });

  it('un schéma syntaxiquement dégradé ne lève pas — mêmes garanties que parsePrismaSchema', () => {
    const introspector = createPrismaIntrospector({ schemaPath: MALFORMED_SCHEMA_PATH });
    expect(() => introspector.introspect()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/prisma/introspector.test.ts`
Expected: FAIL with "Cannot find module '.../adapters/prisma/introspector.js'".

- [ ] **Step 3: Add `SchemaIntrospector`/`DataAdapter` to `adapters/types.ts`**

Append to `src/lib/server/adapters/types.ts` (after the existing `Filter`/`CompositeFilter`/`LeafFilter` declarations):

```ts
import type { Schema, Model } from '../types/schema.js';
import type { RelationEdge } from '../introspection/relations.js';

/** Boot-time schema source. One call per handler lifetime — no per-request cost. */
export interface SchemaIntrospector {
  introspect(): Schema | Promise<Schema>;
}

/**
 * Per-request CRUD + relation-read surface `handler.ts` talks to instead of
 * a raw ORM client. See docs/superpowers/specs/2026-08-13-db-adapter-abstraction-design.md
 * for the rationale behind each method's shape.
 */
export interface DataAdapter {
  /** Vue liste paginée : toujours tri PK desc, toujours count + fetch ensemble. */
  listRecords(
    model: Model,
    opts: { filter?: Filter; skip: number; take: number }
  ): Promise<{ rows: Record<string, unknown>[]; total: number }>;

  /**
   * Lecture générale sans pagination forcée : options de relation FK/m2m,
   * options de filtre FK sidebar, endpoint `_search`. `orderBy` est le
   * `Record<string, 'asc' | 'desc'>` déjà exposé tel quel côté config
   * publique (`AdminHandlerConfig.models[].relations[field].orderBy`) —
   * transmis de façon opaque, sans traduction.
   */
  findMany(
    model: Model,
    opts: { filter?: Filter; orderBy?: Record<string, 'asc' | 'desc'>; skip?: number; take?: number }
  ): Promise<Record<string, unknown>[]>;

  getRecord(model: Model, id: string | number): Promise<Record<string, unknown> | null>;

  findFirst(model: Model, filter: Filter): Promise<Record<string, unknown> | null>;

  countRecords(model: Model, filter?: Filter): Promise<number>;

  /**
   * `m2m`'s value carries the TARGET model's PK field name alongside the raw
   * ids, not just the ids: this adapter has no `Schema`/`RelationGraph` of
   * its own to resolve a target model from an edge, and `handler.ts` (the
   * only caller) already resolves the target model before building this
   * payload, at zero extra cost to it.
   */
  createRecord(
    model: Model,
    input: {
      scalars: Record<string, unknown>;
      m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
    }
  ): Promise<Record<string, unknown>>;

  updateRecord(
    model: Model,
    id: string | number,
    input: {
      scalars: Record<string, unknown>;
      m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
    }
  ): Promise<Record<string, unknown>>;

  deleteRecord(model: Model, id: string | number): Promise<void>;

  /** `targetModel` est fourni par l'appelant : chaque site d'appel actuel l'a déjà résolu. */
  getM2mSelectedIds(
    model: Model,
    edge: RelationEdge,
    targetModel: Model,
    recordId: string | number
  ): Promise<Array<string | number>>;
}
```

- [ ] **Step 4: Implement `createPrismaIntrospector`**

Create `src/lib/server/adapters/prisma/introspector.ts`:

```ts
/** Wraps the existing regex-based `.prisma` file parser behind `SchemaIntrospector`. */
import { parsePrismaSchema } from '../../introspection/parser.js';
import type { SchemaIntrospector } from '../types.js';

export function createPrismaIntrospector(opts: { schemaPath: string }): SchemaIntrospector {
  return {
    introspect() {
      return parsePrismaSchema(opts.schemaPath);
    }
  };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/adapters/prisma/introspector.test.ts`
Expected: PASS.

Run: `bun run check`
Expected: PASS — confirm `RelationEdge`'s import path (`../introspection/relations.js`) resolves cleanly from `adapters/types.ts` with no circular-import issue (`relations.ts` doesn't import from `adapters/`, so there's no cycle).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/adapters/types.ts src/lib/server/adapters/prisma/introspector.ts \
        tests/unit/adapters/prisma/introspector.test.ts
git commit -m "refactor: add SchemaIntrospector/DataAdapter interfaces and the Prisma introspector"
```

---

## Task 4: Prisma `DataAdapter` implementation + `createPrismaAdapter` factory

**Files:**
- Modify: `tests/fixtures/prismaMock.ts` (add `$transaction`)
- Create: `src/lib/server/adapters/prisma/dataAdapter.ts`
- Create: `src/lib/server/adapters/prisma/index.ts`
- Create: `tests/unit/adapters/prisma/dataAdapter.test.ts`
- Create: `tests/unit/adapters/prisma/index.test.ts`

**Interfaces:**
- Consumes: `DataAdapter`, `SchemaIntrospector`, `Filter` (Task 3), `compileFilterToPrismaWhere` (Task 2), `toPrismaModel`/`primaryKeyOf`/`coerceId` (existing `data.ts`, unchanged — imported, not duplicated).
- Produces: `createPrismaDataAdapter(prisma: any): DataAdapter`, `createPrismaAdapter(opts: { prisma: any; schemaPath: string }): { introspector: SchemaIntrospector; data: DataAdapter }` — Task 5 imports `createPrismaAdapter` directly.

This task does **not** touch `handler.ts` or delete anything from `data.ts` yet — `data.ts`'s `listRecords`/`getRecord`/`createRecord`/`updateRecord`/`deleteRecord` stay exactly as they are (still used by the not-yet-rewired `handler.ts`) while `dataAdapter.ts` grows its own, independent implementation next to them. They become dead code once Tasks 5-7 finish rewiring `handler.ts`, and are deleted in Task 9.

- [ ] **Step 1: Add `$transaction` to the Prisma mock**

In `tests/fixtures/prismaMock.ts`, modify the `createPrismaMock` function (currently lines 79-121) to add a `$transaction` method on the returned mock, right after `calls`/`mock` are declared (line 84):

```ts
export function createPrismaMock(
  data: Record<string, unknown[]> = {},
  overrides: Record<string, Record<string, MethodOverride>> = {}
): PrismaMock {
  const calls: PrismaCall[] = [];
  const mock: PrismaMock = {
    calls,
    // Transaction interactive triviale : le mock n'a pas de vraie isolation
    // transactionnelle (pas de rollback simulé), seule la forme d'appel
    // compte pour les tests — `tx` EST `mock`, donc les mêmes `calls` sont
    // journalisés qu'avec ou sans transaction.
    $transaction: (fn: (tx: PrismaMock) => unknown) => Promise.resolve(fn(mock))
  };
  // ... rest of the function body unchanged
```

(The rest of the function — the `for (const modelKey of ...)` loop building `findMany`/`findUnique`/etc. — stays exactly as it is; only the initial `mock` object literal gains the `$transaction` key.)

- [ ] **Step 2: Write the failing test for the Prisma `DataAdapter`**

Create `tests/unit/adapters/prisma/dataAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPrismaDataAdapter } from '../../../../src/lib/server/adapters/prisma/dataAdapter.js';
import { parsePrismaSchema } from '../../../../src/lib/server/introspection/parser.js';
import { buildRelationGraph } from '../../../../src/lib/server/introspection/relations.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH, RELATIONS_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;
const Post = schema.models.find((m) => m.name === 'Post')!;

const relSchema = parsePrismaSchema(RELATIONS_SCHEMA_PATH);
const relGraph = buildRelationGraph(relSchema);
const RelPost = relSchema.models.find((m) => m.name === 'Post')!;
const RelTag = relSchema.models.find((m) => m.name === 'Tag')!;
const tagsEdge = relGraph.edges.get('Post.tags')!;

describe('createPrismaDataAdapter — listRecords', () => {
  it('liste avec skip/take et tri PK desc, count et fetch ensemble', async () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, email: `u${i}@x.y` }));
    const prisma = createPrismaMock({ user: records });
    const adapter = createPrismaDataAdapter(prisma);
    const { rows, total } = await adapter.listRecords(User, { skip: 2, take: 2 });
    expect(rows).toEqual([{ id: 3, email: 'u2@x.y' }, { id: 4, email: 'u3@x.y' }]);
    expect(total).toBe(5);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({
      where: undefined, skip: 2, take: 2, orderBy: { id: 'desc' }
    });
  });

  it('propage un Filter compilé au where', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }, { id: 2, email: 'b@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    const { rows, total } = await adapter.listRecords(User, { filter: { op: 'eq', field: 'id', value: 2 }, skip: 0, take: 20 });
    expect(rows).toEqual([{ id: 2, email: 'b@x.y' }]);
    expect(total).toBe(1);
  });
});

describe('createPrismaDataAdapter — findMany', () => {
  it('sans skip/take : renvoie tout ce qui matche, orderBy transmis tel quel', async () => {
    const records = [{ id: 2, name: 'B' }, { id: 1, name: 'A' }];
    const prisma = createPrismaMock({ user: records });
    const adapter = createPrismaDataAdapter(prisma);
    const rows = await adapter.findMany(User, { orderBy: { name: 'asc' } });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({ where: undefined, orderBy: { name: 'asc' } });
    expect(rows).toEqual(records);
  });

  it('avec skip/take : pagination transmise', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.findMany(User, { skip: 1, take: 1 });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({ skip: 1, take: 1 });
  });
});

describe('createPrismaDataAdapter — countRecords / getRecord / findFirst', () => {
  it('countRecords sans filter', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.countRecords(User)).toBe(2);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: undefined });
  });

  it('countRecords avec filter compilé', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.countRecords(User, { op: 'eq', field: 'id', value: 1 })).toBe(1);
  });

  it('getRecord coerce l\'id via la PK du modèle', async () => {
    const prisma = createPrismaMock({ user: [{ id: 3, email: 'c@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.getRecord(User, '3')).toEqual({ id: 3, email: 'c@x.y' });
  });

  it('findFirst applique le filter tel quel (scoping)', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, tenantId: 9 }, { id: 2, tenantId: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);
    const row = await adapter.findFirst(User, {
      op: 'and',
      clauses: [{ op: 'eq', field: 'id', value: 1 }, { tenantId: 9 } as never]
    });
    expect(row).toEqual({ id: 1, tenantId: 9 });
  });
});

describe('createPrismaDataAdapter — createRecord / updateRecord (sans m2m)', () => {
  it('createRecord sans m2m : create direct, pas de $transaction', async () => {
    const prisma = createPrismaMock({ user: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(User, { scalars: { email: 'n@x.y' } });
    expect(callsTo(prisma, 'user', 'create')[0].args).toEqual({ data: { email: 'n@x.y' } });
    expect(prisma.calls.some((c) => c.method === '$transaction')).toBe(false);
  });

  it('updateRecord sans m2m : update direct par PK coercée', async () => {
    const prisma = createPrismaMock({ user: [{ id: 2, email: 'old@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(User, '2', { scalars: { email: 'new@x.y' } });
    expect(callsTo(prisma, 'user', 'update')[0].args).toEqual({ where: { id: 2 }, data: { email: 'new@x.y' } });
  });

  it('deleteRecord par PK coercée', async () => {
    const prisma = createPrismaMock({ user: [{ id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.deleteRecord(User, '2');
    expect(callsTo(prisma, 'user', 'delete')[0].args).toEqual({ where: { id: 2 } });
  });
});

describe('createPrismaDataAdapter — createRecord / updateRecord (avec m2m)', () => {
  it('createRecord avec m2m : connect, dans une transaction', async () => {
    const prisma = createPrismaMock({ post: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(RelPost, {
      scalars: { title: 'T', authorId: 1 },
      m2m: { tags: { targetPkField: 'id', ids: [1, 2] } }
    });
    const create = callsTo(prisma, 'post', 'create')[0];
    expect(create.args).toEqual({ data: { title: 'T', authorId: 1, tags: { connect: [{ id: 1 }, { id: 2 }] } } });
  });

  it('updateRecord avec m2m : set, dans une transaction', async () => {
    const prisma = createPrismaMock({ post: [{ id: 'p1', title: 'T', authorId: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(RelPost, 'p1', {
      scalars: { title: 'T2' },
      m2m: { tags: { targetPkField: 'id', ids: [2] } }
    });
    const update = callsTo(prisma, 'post', 'update')[0];
    expect(update.args).toEqual({ where: { id: 'p1' }, data: { title: 'T2', tags: { set: [{ id: 2 }] } } });
  });

  it('m2m avec une liste vide : set: [] (vide la relation), toujours transactionnel', async () => {
    const prisma = createPrismaMock({ post: [{ id: 'p1', title: 'T' }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(RelPost, 'p1', {
      scalars: { title: 'T' },
      m2m: { tags: { targetPkField: 'id', ids: [] } }
    });
    expect(callsTo(prisma, 'post', 'update')[0].args).toEqual({ where: { id: 'p1' }, data: { title: 'T', tags: { set: [] } } });
  });

  it('m2m sur une PK cible String (non-Int) : idRefs porte des strings', async () => {
    const prisma = createPrismaMock({ post: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(RelPost, {
      scalars: { title: 'T' },
      m2m: { labels: { targetPkField: 'slug', ids: ['a', 'b'] } }
    });
    expect(callsTo(prisma, 'post', 'create')[0].args).toEqual({
      data: { title: 'T', labels: { connect: [{ slug: 'a' }, { slug: 'b' }] } }
    });
  });
});

describe('createPrismaDataAdapter — getM2mSelectedIds', () => {
  it('lit les ids liés via include, mappés sur la PK cible', async () => {
    const prisma = createPrismaMock({
      post: [{ id: 'p1', title: 'T', tags: [{ id: 1, name: 'js' }, { id: 2, name: 'ts' }] }]
    });
    const adapter = createPrismaDataAdapter(prisma);
    const ids = await adapter.getM2mSelectedIds(RelPost, tagsEdge, RelTag, 'p1');
    expect(ids).toEqual([1, 2]);
    expect(callsTo(prisma, 'post', 'findUnique')[0].args).toEqual({
      where: { id: 'p1' }, include: { tags: true }
    });
  });

  it('cible absente du client : liste vide, pas de throw', async () => {
    const prisma = createPrismaMock({});
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.getM2mSelectedIds(RelPost, tagsEdge, RelTag, 'p1')).toEqual([]);
  });
});
```

Confirmed against `tests/fixtures/schemas/relations.prisma`: `Post.labels` is `Label[]`, and `Label`'s PK is `slug String @id` — the `targetPkField: 'slug'` used in the `labels` test above is exactly right, no adjustment needed.

- [ ] **Step 3: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/prisma/dataAdapter.test.ts`
Expected: FAIL with "Cannot find module '.../adapters/prisma/dataAdapter.js'".

- [ ] **Step 4: Implement `createPrismaDataAdapter`**

Create `src/lib/server/adapters/prisma/dataAdapter.ts`:

```ts
import type { Model } from '../../types/schema.js';
import type { RelationEdge } from '../../introspection/relations.js';
import { toPrismaModel, primaryKeyOf, coerceId } from '../../data.js';
import { compileFilterToPrismaWhere } from './filterCompiler.js';
import type { DataAdapter, Filter } from '../types.js';

/**
 * Prisma implementation of `DataAdapter`. `caseInsensitiveSearch` is fixed
 * at construction time (Task 5's boot block resolves it from the schema's
 * `provider`/`config.search.mode` before building this adapter) — it's the
 * same value `buildWhere`'s caller in `handler.ts` used to pass directly to
 * `buildWhere`, just applied one layer later, at compile-to-Prisma-where
 * time instead of at Filter-construction time. It only affects `contains`
 * leaves; every other leaf/composite op ignores it.
 */
export function createPrismaDataAdapter(
  prisma: any,
  opts: { caseInsensitiveSearch?: boolean } = {}
): DataAdapter {
  const compileHere = (filter: Filter | undefined) =>
    compileFilterToPrismaWhere(filter, opts.caseInsensitiveSearch ?? false);

  return {
    async listRecords(model: Model, listOpts) {
      const key = toPrismaModel(model.name);
      const primaryKey = primaryKeyOf(model);
      const where = compileHere(listOpts.filter);
      const [rows, total] = await Promise.all([
        prisma[key].findMany({ where, skip: listOpts.skip, take: listOpts.take, orderBy: { [primaryKey]: 'desc' } }),
        prisma[key].count({ where })
      ]);
      return { rows, total };
    },

    findMany(model: Model, findOpts) {
      const key = toPrismaModel(model.name);
      const where = compileHere(findOpts.filter);
      return prisma[key].findMany({ where, orderBy: findOpts.orderBy, skip: findOpts.skip, take: findOpts.take });
    },

    getRecord(model: Model, id) {
      const primaryKey = primaryKeyOf(model);
      return prisma[toPrismaModel(model.name)].findUnique({
        where: { [primaryKey]: coerceId(String(id), model) }
      });
    },

    findFirst(model: Model, filter) {
      const key = toPrismaModel(model.name);
      return prisma[key].findFirst({ where: compileHere(filter) });
    },

    countRecords(model: Model, filter) {
      const key = toPrismaModel(model.name);
      return prisma[key].count({ where: compileHere(filter) });
    },

    async createRecord(model: Model, input) {
      const key = toPrismaModel(model.name);
      const m2mFields = Object.keys(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return prisma[key].create({ data: input.scalars });
      }
      return prisma.$transaction(async (tx: any) => {
        const data: Record<string, unknown> = { ...input.scalars };
        for (const field of m2mFields) {
          const { targetPkField, ids } = input.m2m![field];
          data[field] = { connect: ids.map((id) => ({ [targetPkField]: id })) };
        }
        return tx[key].create({ data });
      });
    },

    async updateRecord(model: Model, id, input) {
      const key = toPrismaModel(model.name);
      const primaryKey = primaryKeyOf(model);
      const where = { [primaryKey]: coerceId(String(id), model) };
      const m2mFields = Object.keys(input.m2m ?? {});
      if (m2mFields.length === 0) {
        return prisma[key].update({ where, data: input.scalars });
      }
      return prisma.$transaction(async (tx: any) => {
        const data: Record<string, unknown> = { ...input.scalars };
        for (const field of m2mFields) {
          const { targetPkField, ids } = input.m2m![field];
          data[field] = { set: ids.map((id) => ({ [targetPkField]: id })) };
        }
        return tx[key].update({ where, data });
      });
    },

    async deleteRecord(model: Model, id) {
      const primaryKey = primaryKeyOf(model);
      await prisma[toPrismaModel(model.name)].delete({ where: { [primaryKey]: coerceId(String(id), model) } });
    },

    async getM2mSelectedIds(model: Model, edge: RelationEdge, targetModel: Model, recordId) {
      try {
        const primaryKey = primaryKeyOf(model);
        const current = await prisma[toPrismaModel(model.name)].findUnique({
          where: { [primaryKey]: coerceId(String(recordId), model) },
          include: { [edge.field]: true }
        });
        const linked: Record<string, unknown>[] = current?.[edge.field] ?? [];
        const targetPk = primaryKeyOf(targetModel);
        return linked.map((row) => row[targetPk] as string | number);
      } catch {
        return [];
      }
    }
  };
}
```

- [ ] **Step 5: Implement `createPrismaAdapter`**

The case-insensitive-search decision (today computed inline in `handler.ts` from `schema.provider`/`config.search.mode`, lines 258-267 of the pre-Task-5 file) is Prisma-specific (`mode: 'insensitive'` is a Prisma where-clause detail) — it belongs next to `createPrismaDataAdapter`, not in `handler.ts`. Move it here as a small exported helper so both `createPrismaAdapter` (this step) and `createAdminHandler`'s own legacy-path boot (Task 5, which needs the exact same computation but with graceful degradation on a failed parse — see there) can share it instead of duplicating the three-line rule twice.

Create `src/lib/server/adapters/prisma/index.ts`:

```ts
import { createPrismaIntrospector } from './introspector.js';
import { createPrismaDataAdapter } from './dataAdapter.js';
import type { SchemaIntrospector, DataAdapter } from '../types.js';
import type { Schema } from '../../types/schema.js';

export { compileFilterToPrismaWhere } from './filterCompiler.js';

/**
 * `mode: 'insensitive'` is only valid Prisma-side on postgresql/cockroachdb/
 * mongodb — emitting it on sqlite/mysql/sqlserver is a hard Prisma error.
 * `schema` is `null` when introspection failed (the caller degraded
 * gracefully instead of throwing) — in that case `'auto'` can never detect a
 * supported provider, so it resolves to `false`, same as today.
 */
export function resolveCaseInsensitiveSearch(
  schema: Schema | null,
  searchMode: 'auto' | 'insensitive' | 'default' = 'auto'
): boolean {
  return (
    searchMode === 'insensitive' ||
    (searchMode === 'auto' && ['postgresql', 'cockroachdb', 'mongodb'].includes(schema?.provider ?? ''))
  );
}

/**
 * Builds a ready-to-use Prisma adapter. Introspects eagerly (throws
 * immediately on a bad `schemaPath`) — this is the explicit-construction
 * path (`createAdminHandler({ adapter: createPrismaAdapter(...) })`), where
 * failing loud on a caller's own mistake is correct. `createAdminHandler`'s
 * OWN legacy `{ prisma, prismaSchemaPath }` path does NOT call this function
 * — it builds the introspector/data pair itself so it can keep degrading
 * gracefully to "no models known" on a bad path, exactly as it always has.
 */
export function createPrismaAdapter(opts: {
  prisma: any;
  schemaPath: string;
  searchMode?: 'auto' | 'insensitive' | 'default';
}): { introspector: SchemaIntrospector; data: DataAdapter } {
  const introspector = createPrismaIntrospector({ schemaPath: opts.schemaPath });
  const schema = introspector.introspect() as Schema;
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(schema, opts.searchMode);
  return {
    introspector: { introspect: () => schema }, // memoized: introspect() already ran once above
    data: createPrismaDataAdapter(opts.prisma, { caseInsensitiveSearch })
  };
}
```

- [ ] **Step 6: Write `createPrismaAdapter`'s own test**

Create `tests/unit/adapters/prisma/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPrismaAdapter } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

describe('createPrismaAdapter', () => {
  it('compose introspector + data en un seul objet fonctionnel', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });

    const schema = await adapter.introspector.introspect();
    const User = schema.models.find((m) => m.name === 'User')!;

    const { rows, total } = await adapter.data.listRecords(User, { skip: 0, take: 20 });
    expect(total).toBe(1);
    expect(rows).toEqual([{ id: 1, email: 'a@x.y' }]);
  });
});
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/adapters/prisma/`
Expected: PASS.

Run: `bun run test:coverage`
Expected: 100% on every new file. Pay attention to the `catch` branch in `getM2mSelectedIds` (covered by the "cible absente du client" test) and both branches of the `m2mFields.length === 0` check in `createRecord`/`updateRecord` (covered by the with/without-m2m test pairs).

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/prismaMock.ts src/lib/server/adapters/types.ts \
        src/lib/server/adapters/prisma/dataAdapter.ts src/lib/server/adapters/prisma/index.ts \
        tests/unit/adapters/prisma/dataAdapter.test.ts tests/unit/adapters/prisma/index.test.ts
git commit -m "feat: implement createPrismaDataAdapter and the createPrismaAdapter factory"
```

---

## Task 5: Wire `createAdminHandler`'s boot sequence to the adapter

**Files:**
- Modify: `src/lib/server/handler.ts:1-9,38-42,184-268` (imports, `AdminHandlerConfig`, boot block)

**Interfaces:**
- Consumes: `createPrismaAdapter` (Task 4), `SchemaIntrospector`/`DataAdapter` (Task 3).
- Produces: `config.adapter` — the new, optional `AdminHandlerConfig` field Task 6/7 read from; `adapter`/`schema`/`relationGraph` closure variables inside `createAdminHandler`, same names and same values as today's `schema`/`relationGraph`, just sourced differently.

This task changes ONLY the boot sequence (schema/relation-graph acquisition) — every per-request call site (`loadRelationOptions`, POST handling, the list view, etc.) still calls `prisma[...]`/`data.ts` functions exactly as before. That's Tasks 6-7. After this task, `prisma` and `schema`/`relationGraph` must still hold the exact same values they did before, just derived through the adapter — so the entire existing test suite passes unmodified.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/handler.test.ts` (create the describe block near the top of the file, after existing imports — check the file's current top-level structure with `grep -n "^describe" tests/unit/handler.test.ts` first to place it consistently with existing conventions):

```ts
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';

describe('createAdminHandler — config.adapter explicite', () => {
  it('accepte un adapter fourni directement, sans prisma/prismaSchemaPath', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });
});
```

(Adjust the exact imports — `createPrismaMock`, `FULL_SCHEMA_PATH`, `createEvent`, `createAdminHandler` — to whatever `tests/unit/handler.test.ts` already imports; this test slots into the existing file, it doesn't need its own new file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/handler.test.ts -t "accepte un adapter fourni directement"`
Expected: FAIL — `config.adapter` doesn't exist yet, `createAdminHandler` still requires `config.prisma`.

- [ ] **Step 3: Add `adapter` to `AdminHandlerConfig` and rewrite the boot block**

Two things must both keep working exactly as today for the legacy `{ prisma, prismaSchemaPath }` path: (1) a bad/missing schema path degrades gracefully to "no models known" instead of throwing out of `createAdminHandler`, and (2) `caseInsensitiveSearch` is resolved from the successfully-parsed schema's `provider` (or stays `false` if parsing failed). Because `createPrismaAdapter` (Task 4, Step 5) introspects *eagerly* and throws on failure, `createAdminHandler`'s own boot block does **not** call it for the legacy path — it builds the introspector and, once `caseInsensitiveSearch` is known, the data adapter, itself, using the same pieces `createPrismaAdapter` is built from. `config.adapter` (the new explicit path) bypasses all of this and is used as-is.

In `src/lib/server/handler.ts`, add the import (near the top, after the existing `relations.js` import at line 8):

```ts
import { createPrismaIntrospector } from './adapters/prisma/introspector.js';
import { createPrismaDataAdapter } from './adapters/prisma/dataAdapter.js';
import { resolveCaseInsensitiveSearch } from './adapters/prisma/index.js';
import type { DataAdapter, SchemaIntrospector } from './adapters/types.js';
```

In the `AdminHandlerConfig` interface (lines 38-42), change:

```ts
export interface AdminHandlerConfig {
  /** Prisma client instance */
  prisma: any;
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
```

to:

```ts
export interface AdminHandlerConfig {
  /**
   * Prisma client instance. Required unless `adapter` is provided directly —
   * exactly one of the two must be set. Kept required-looking here (not `?`)
   * for source compatibility with every existing call site; passing neither
   * throws at handler-creation time (see the boot block).
   */
  prisma?: any;
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
  /**
   * Explicit adapter, built via `createPrismaAdapter(...)` (or, in a future
   * release, a Drizzle/other adapter). Takes priority over `prisma`/
   * `prismaSchemaPath` when both are somehow set. Most consumers never touch
   * this — passing `prisma`/`prismaSchemaPath` builds one internally.
   */
  adapter?: { introspector: SchemaIntrospector; data: DataAdapter };
```

`SchemaIntrospector.introspect()` is typed `Schema | Promise<Schema>` (Task 3) for a future async introspector (e.g. a Drizzle adapter reading a live database catalog), but `createAdminHandler` itself stays fully synchronous, exactly as today (it's called everywhere as `export const handle = createAdminHandler({...})`, never awaited) — it only supports a synchronous `introspect()` result, and throws its own clear error if handed an introspector that returns a Promise, rather than silently misbehaving.

Replace the destructuring + boot block (lines 184-208) — from `export function createAdminHandler(config: AdminHandlerConfig) {` through the end of the `catch` block that logs the parse failure — with:

```ts
export function createAdminHandler(config: AdminHandlerConfig) {
  const {
    prisma,
    prismaSchemaPath = './prisma/schema.prisma',
    basePath = '/admin',
    authCheck,
    logout,
    logoutRedirectTo = '/',
    exclude = [],
    hidePivotTables = true,
    models: modelsConfig = {}
  } = config;

  const introspector: SchemaIntrospector =
    config.adapter?.introspector ?? createPrismaIntrospector({ schemaPath: prismaSchemaPath });

  // Introspect the schema once at startup — same failure handling as before:
  // a broken/missing schema source degrades to "no models known" rather than
  // throwing out of `createAdminHandler` itself.
  let schema: Schema | null = null;
  let relationGraph: RelationGraph | null = null;
  try {
    const introspected = introspector.introspect();
    if (introspected instanceof Promise) {
      throw new Error(
        '[sveltekit-admin] SchemaIntrospector.introspect() returned a Promise — ' +
          'createAdminHandler only supports synchronous introspection today.'
      );
    }
    schema = introspected;
    relationGraph = buildRelationGraph(schema);
    for (const d of relationGraph.diagnostics) {
      console.warn(`[sveltekit-admin] ${d}`);
    }
  } catch (e) {
    console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
  }
```

Everything between this block and the current `caseInsensitiveSearch` computation — `filteredModels`, `hiddenFieldsOf`, the `validateListFilterConfig` boot loop, `labelOf`, `modelList`, `findModel`, `viewModel`, `redirectToList`, `selectThreshold`, `filterLinkThreshold`, `labelFieldCandidates` — stays completely untouched; none of it depends on `prisma`/the data adapter, only on `schema`/`relationGraph`/`config`, all already available above.

Replace the `caseInsensitiveSearch` computation (originally the block starting with `const searchMode = config.search?.mode ?? 'auto';`) with:

```ts
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(schema, config.search?.mode);

  const adapter: { introspector: SchemaIntrospector; data: DataAdapter } =
    config.adapter ?? { introspector, data: createPrismaDataAdapter(prisma, { caseInsensitiveSearch }) };
```

This is the one and only place `adapter` (the closure variable Tasks 6-7 read `adapter.data.*` from) gets built. Add the `Schema`/`PrismaModel` import adjustment at the top of `handler.ts` — it currently imports `parsePrismaSchema, type PrismaSchema, type PrismaModel, isSensitiveFieldName` from `./introspection/parser.js`; `parsePrismaSchema`/`PrismaSchema` are no longer referenced directly in this file (introspection now goes through `introspector`/`createPrismaIntrospector`), so change that import to:

```ts
import { type PrismaModel, isSensitiveFieldName } from './introspection/parser.js';
import type { Schema } from './types/schema.js';
```

and change every remaining `PrismaSchema`-typed local in this file (just the `let schema: PrismaSchema | null` declaration, already rewritten to `Schema` above) accordingly — `grep -n "PrismaSchema" src/lib/server/handler.ts` should return nothing once this task is done.

- [ ] **Step 4: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/handler.test.ts`
Expected: PASS, including the new `config.adapter` test.

Run: `bun run test`
Expected: PASS in full — every existing test still passes `{ prisma, prismaSchemaPath }`, which now builds a `createPrismaAdapter` internally but resolves to the exact same `schema`/`relationGraph` values (same `parsePrismaSchema` call, just one layer deeper), so nothing downstream in `handler.ts` (still calling `prisma[...]` directly at every other site — untouched until Tasks 6-7) observes any difference.

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/handler.ts tests/unit/handler.test.ts
git commit -m "refactor: createAdminHandler builds/accepts a DbAdapter at boot instead of calling parsePrismaSchema directly"
```

---

## Task 6: Rewire `handler.ts`'s GET-path reads to `adapter.data`

**Files:**
- Modify: `src/lib/server/handler.ts` (`loadRelationOptions`, `resolveFkFilterOptions`, `loadSelectedIds`→uses `getM2mSelectedIds`, `loadRelatedCounts`, `handleSearch`, dashboard counts, the list-view branch, the edit-view `getRecord` call)

**Interfaces:**
- Consumes: `adapter.data` (Task 5's closure variable), `Filter` leaf builders (`{ op: 'eq', ... }` / `{ op: 'in', ... }`, Task 2's `Filter` type).
- Produces: nothing new — this task's deliverable is "every GET-path read goes through `adapter.data`, behavior identical."

This task leaves the POST branch (create/update/delete, FK/m2m revalidation) untouched — that's Task 7. `data.ts`'s `listRecords`/`getRecord`/`createRecord`/`updateRecord`/`deleteRecord` are still imported at the top of `handler.ts` after this task (POST still uses them) — only the GET-path call sites below stop using them/raw `prisma`.

- [ ] **Step 1: Write the failing test**

This task is a pure internal rewire with no behavior change, so there's no *new* test to write — the existing suite is the specification. Instead, confirm the safety net is in place before touching anything:

Run: `bun run test`
Expected: PASS (baseline, before this task's edits).

- [ ] **Step 2: Rewrite `loadRelationOptions`**

Replace the `loadRelationOptions` function body (`handler.ts:325-380`) with:

```ts
  const loadRelationOptions = async (
    model: PrismaModel,
    ctx: { locals?: any },
    currentId?: string
  ): Promise<Map<string, import('./views/types.js').RelationMeta>> => {
    const edges = [...relationGraph!.edges.values()].filter((edge) => {
      if (edge.model !== model.name) return false;
      if (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m-implicit') return false;
      if (edge.unsupported) return false;
      const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
      return relConfig?.widget !== 'hidden';
    });

    const entries = await Promise.all(
      edges.map(async (edge): Promise<[string, import('./views/types.js').RelationMeta]> => {
        const key = `${edge.model}.${edge.field}`;
        const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
        const targetModel = schema!.models.find((m) => m.name === edge.target)!;
        const filter = relConfig?.where ? (relConfig.where(ctx) as any) : undefined;

        try {
          const total = await adapter.data.countRecords(targetModel, filter);
          if (total > selectThreshold || relConfig?.widget === 'raw-id') {
            const selectedIds =
              edge.kind === 'm2m-implicit' && currentId
                ? await adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId)
                : undefined;
            return [key, { tooMany: true, options: [], selectedIds }];
          }

          const rows = await adapter.data.findMany(targetModel, { filter, orderBy: relConfig?.orderBy });
          const options = rows.map((row) => ({
            id: row[primaryKeyOf(targetModel)] as string | number,
            label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
          }));
          const selectedIds =
            edge.kind === 'm2m-implicit' && currentId
              ? await adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId)
              : undefined;
          return [key, { tooMany: false, options, selectedIds }];
        } catch {
          return [key, { tooMany: true, options: [] }];
        }
      })
    );
    return new Map(entries);
  };
```

Note `filter` here is a raw Prisma-shaped object (`relConfig.where(ctx)`, developer-supplied config, unchanged shape) — `DataAdapter.countRecords`/`findMany` type their `filter`/`opts.filter` parameter as `Filter`, but at runtime `compileFilterToPrismaWhere` (called inside `createPrismaDataAdapter`, Task 4) already treats any object without a recognized `op` key as an opaque pass-through (see Task 2 Step 5's `compile` function: `if ('op' in node ...) ... return node as PrismaWhere`). The `as any` cast is deliberate and matches how `buildWhere` already treats `scope` as an opaque escape hatch (Task 2, Step 4) — a raw developer-supplied `where` was never going to be expressed as a `Filter` AST, and forcing it through one would be a lossless round-trip for no benefit.

- [ ] **Step 3: Rewrite `resolveFkFilterOptions`**

Replace `handler.ts:390-473` with:

```ts
  const resolveFkFilterOptions = async (
    model: PrismaModel,
    fkFieldName: string,
    label: string,
    ctx: { locals?: any },
    activeRawValue: string | undefined
  ): Promise<import('./views/types.js').FkFilterMeta> => {
    const edge = findFkEdge(relationGraph!, model.name, fkFieldName)!;
    const targetModel = schema!.models.find((m) => m.name === edge.target)!;
    const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
    const scope = relConfig?.where ? (relConfig.where(ctx) as any) : undefined;

    const loadOptions = async (): Promise<{
      options: { id: string | number; label: string }[];
      tooMany: boolean;
    }> => {
      try {
        const total = await adapter.data.countRecords(targetModel, scope);
        if (total > selectThreshold) {
          return { options: [], tooMany: true };
        }
        const rows = await adapter.data.findMany(targetModel, { filter: scope, orderBy: relConfig?.orderBy });
        const options = rows.map((row) => ({
          id: row[primaryKeyOf(targetModel)] as string | number,
          label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
        }));
        return { options, tooMany: false };
      } catch {
        return { options: [], tooMany: true };
      }
    };

    const loadActiveLabel = async (): Promise<string | undefined> => {
      if (activeRawValue === undefined) return undefined;
      const activeId = coerceId(activeRawValue, targetModel);
      try {
        const idFilter = { op: 'eq', field: primaryKeyOf(targetModel), value: activeId } as const;
        const filter = scope ? ({ op: 'and', clauses: [idFilter, scope] } as any) : idFilter;
        const row = await adapter.data.findFirst(targetModel, filter);
        return row ? resolveLabel(targetModel, row, relConfig?.labelTemplate) : undefined;
      } catch {
        return undefined;
      }
    };

    const [{ options, tooMany }, activeLabel] = await Promise.all([loadOptions(), loadActiveLabel()]);

    return {
      field: fkFieldName,
      label,
      relationField: edge.field,
      targetModel: edge.target,
      options,
      mode: tooMany ? 'raw-id' : options.length <= filterLinkThreshold ? 'links' : 'select',
      tooMany,
      activeLabel,
      activeHref:
        activeLabel && findModel(edge.target)
          ? `${basePath}/${edge.target.toLowerCase()}/${encodeURIComponent(activeRawValue!)}`
          : undefined
    };
  };
```

- [ ] **Step 4: Delete `loadSelectedIds`, use `adapter.data.getM2mSelectedIds` directly**

Delete the `loadSelectedIds` function entirely (`handler.ts:476-492`) — its two call sites, already rewritten in Step 2 above, now call `adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId)` directly instead.

- [ ] **Step 5: Rewrite `loadRelatedCounts`**

Replace `handler.ts:500-530` with:

```ts
  const loadRelatedCounts = async (
    model: PrismaModel,
    currentId: string
  ): Promise<Map<string, number>> => {
    const edges = [...relationGraph!.edges.values()].filter(
      (edge) => edge.model === model.name && (edge.kind === 'to-many-inverse' || edge.kind === 'to-one-inverse')
    );

    const entries = await Promise.all(
      edges.map(async (edge): Promise<[string, number] | undefined> => {
        const owning = [...relationGraph!.edges.values()].find(
          (o) => o.model === edge.target && o.kind === 'to-one-owning' && o.relationName === edge.relationName
        );
        if (!owning || owning.unsupported) return undefined;

        const scalarName = owning.scalarFields[0];
        const key = `${edge.model}.${edge.field}`;
        const targetModel = schema!.models.find((m) => m.name === edge.target)!;
        try {
          const count = await adapter.data.countRecords(targetModel, {
            op: 'eq',
            field: scalarName,
            value: coerceId(currentId, model)
          });
          return [key, count];
        } catch {
          return [key, 0];
        }
      })
    );
    return new Map(entries.filter((e): e is [string, number] => e !== undefined));
  };
```

(`targetModel` is a new local here — the original didn't need it because `toPrismaModel(edge.target)` only needs the model *name*, but `adapter.data.countRecords` takes a full `Model`. Resolved the same way every other site in this file already resolves a target model: `schema!.models.find((m) => m.name === edge.target)!`.)

- [ ] **Step 6: Rewrite `handleSearch`**

Replace `handler.ts:567-596` (the `where`-building and fetch inside `handleSearch`) — keep everything above `const where: Record<string, unknown> = {...}` (lines 540-566) unchanged, and replace from there to the end of the function with:

```ts
    const searchFilter =
      q && searchField
        ? ({ op: 'and', clauses: [configWhere, { op: 'contains', field: searchField, value: q }] } as any)
        : (configWhere as any);

    try {
      const total = await adapter.data.countRecords(targetModel, searchFilter);
      const rows = await adapter.data.findMany(targetModel, {
        filter: searchFilter,
        orderBy: relConfig?.orderBy,
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE
      });
      const options = rows.map((row) => ({
        id: row[primaryKeyOf(targetModel)],
        label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
      }));
      return new Response(JSON.stringify({ options, total, page }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'search failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
```

`configWhere` (still built exactly as today, a couple of lines above this replacement: `const configWhere = relConfig?.where ? relConfig.where({ locals: event.locals }) : {};`) is `{}` when there's no scope config. The ternary above only wraps in `and` when `q && searchField` is true; with no search term, `searchFilter` is `configWhere` alone (`{}` or the developer's scope object), matching today's `where = configWhere` exactly — no spurious `AND` wrapper is introduced for the common no-search-term case.

- [ ] **Step 7: Rewrite the dashboard count loop**

Replace `handler.ts:800-810` (inside the `route.view === 'dashboard'` branch) with:

```ts
        const modelsWithCounts = await Promise.all(
          filteredModels.map(async (m) => {
            let count = 0;
            try {
              count = await adapter.data.countRecords(m);
            } catch {
              // model absent from the database
            }
            return { name: m.name, label: labelOf(m), count };
          })
        );
```

- [ ] **Step 8: Rewrite the list-view branch**

Replace `handler.ts:859` (`const { items, total } = await listRecords(prisma, model, page, PER_PAGE, where);`) — this line sits right after Task 2's `const filter = buildWhere(listQuery, listScope, caseInsensitiveSearch, model);` (Task 2, Step 6 also inserted a `compileFilterToPrismaWhere(filter, caseInsensitiveSearch)` call there; delete that call now — it's superseded by passing `filter` straight to `adapter.data.listRecords`, which compiles it internally with the exact same `caseInsensitiveSearch` value, already baked in at adapter-construction time in Task 5, Step 3). Replace both lines with:

```ts
        const filter = buildWhere(listQuery, listScope, caseInsensitiveSearch, model) as any;
        const { rows: items, total } = await adapter.data.listRecords(model, { filter, skip: (page - 1) * PER_PAGE, take: PER_PAGE });
```

Remove the now-unused `compileFilterToPrismaWhere` import from the top of `handler.ts` (added in Task 2, Step 6) — `grep -n "compileFilterToPrismaWhere" src/lib/server/handler.ts` should return nothing after this change.

- [ ] **Step 9: Rewrite the edit-view's `getRecord` call**

Replace `handler.ts:929` (`const item = await getRecord(prisma, model, route.id!);`, inside the `else` branch of the model-view dispatch that renders the edit form) with:

```ts
          const item = await adapter.data.getRecord(model, route.id!);
```

Remove the `getRecord` import from `data.ts` at the top of `handler.ts` — after this step, `data.ts`'s `listRecords` and `getRecord` have zero remaining callers in `handler.ts` (they were never called from the POST branch either; only `createRecord`/`updateRecord`/`deleteRecord` are, and those are Task 7's concern). They stay defined in `data.ts` with their existing tests in `tests/unit/data.test.ts` until Task 9 deletes them as confirmed-dead code.

- [ ] **Step 10: Run tests, verify they pass**

Run: `bun run test`
Expected: PASS in full, including `tests/characterization/handler.snapshot.test.ts` and `tests/integration/handler.db.test.ts` unmodified. Every test that exercises a GET route (list, dashboard, create form, edit form, FK filters, search endpoint) now flows through `adapter.data` and must produce byte-identical output.

If any test fails, the most likely cause is a `Filter`-vs-raw-object mismatch at one of the `as any` boundaries introduced above (e.g. `scope`/`configWhere` being `{}` vs `undefined` where the original code branched differently) — compare the failing assertion's expected Prisma call args against what `compileFilterToPrismaWhere` produces for the same input and adjust the specific call site, not the general approach.

Run: `bun run test:coverage`
Expected: 100%. `data.ts`'s `listRecords`/`getRecord` keep their existing tests in `tests/unit/data.test.ts` passing unmodified even though `handler.ts` no longer calls them — the functions themselves aren't touched by this task, only their caller.

- [ ] **Step 11: Commit**

```bash
git add src/lib/server/handler.ts
git commit -m "refactor: route every GET-path handler.ts read through adapter.data"
```

---

## Task 7: Rewire `handler.ts`'s POST-path to `adapter.data`

**Files:**
- Modify: `src/lib/server/handler.ts:646-794` (the entire POST branch)
- Modify: `tests/unit/m2mImplicit.test.ts` (only if any assertion needs adjusting — see Step 4's note; expect most to pass unmodified per Task 4's transaction-transparency guarantee)

**Interfaces:**
- Consumes: `adapter.data.findFirst`, `adapter.data.findMany`, `adapter.data.createRecord`, `adapter.data.updateRecord`, `adapter.data.deleteRecord` (Task 3/4).
- Produces: nothing new — deliverable is "POST create/update/delete + FK/m2m revalidation go through `adapter.data`, with m2m expressed as `{scalars, m2m}` instead of Prisma `connect`/`set` literals built by `handler.ts` itself."

- [ ] **Step 1: Baseline**

Run: `bun run test`
Expected: PASS (confirms Task 6 landed clean before this task's edits).

- [ ] **Step 2: Rewrite the delete branch and the FK-scalar revalidation loop**

Replace `handler.ts:659-661` (the delete branch) with:

```ts
          if (action === 'delete' && route.id) {
            await adapter.data.deleteRecord(model, route.id);
            return redirectToList(route.model);
          }
```

Replace the FK owning-relation revalidation loop's existence check (`handler.ts:710-722`, inside the `for (const edge of relationGraph.edges.values())` loop handling `to-one-owning`) — specifically the `try { const found = await prisma[toPrismaModel(edge.target)].findFirst({ where }); ... }` block — with:

```ts
                try {
                  const idFilter = { op: 'eq' as const, field: primaryKeyOf(targetModel), value: coerced };
                  const scopeFilter = relConfig?.where ? (relConfig.where({ locals: event.locals }) as any) : undefined;
                  const filter = scopeFilter ? ({ op: 'and', clauses: [idFilter, scopeFilter] } as any) : idFilter;
                  const found = await adapter.data.findFirst(targetModel, filter);
                  if (!found) {
                    throw new Error(`${edge.field}: invalid value`);
                  }
                } catch (e: any) {
                  if (e?.message?.includes('invalid value')) throw e;
                  // Client incapable de vérifier (mock partiel, etc.) : on laisse passer.
                }
```

(Everything above this block in the loop — reading `raw` from `formData`, the empty-value/required check, the coercion to `coerced`, the self-referential check — stays exactly as it is; only the existence-check `try` block's body changes.)

- [ ] **Step 3: Rewrite the m2m revalidation + write loop**

Replace `handler.ts:732-782` (the entire `for (const edge of relationGraph.edges.values())` loop handling `m2m-implicit`, from reading `__rel_present__`/`__rel__` through building `data[edge.field]`) with:

```ts
              const m2mInput: Record<string, { targetPkField: string; ids: Array<string | number> }> = {};

              for (const edge of relationGraph.edges.values()) {
                if (edge.model !== model.name || edge.kind !== 'm2m-implicit') continue;

                const present = formData.get(`__rel_present__${edge.field}`);
                if (present === null) continue;

                const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
                const targetModel = schema!.models.find((m) => m.name === edge.target)!;
                const targetPk = primaryKeyOf(targetModel);
                const pkIsInt = targetModel.fields.find((f) => f.isId)?.type === 'Int';

                const submitted = formData.getAll(`__rel__${edge.field}`).map(String);
                const rawIds: string[] =
                  submitted.length === 1 && submitted[0].includes(',')
                    ? submitted[0].split(',').map((s: string) => s.trim()).filter(Boolean)
                    : submitted;

                const ids: (string | number)[] = rawIds.map((v: string) =>
                  pkIsInt ? parseInt(v) : v
                );
                if (pkIsInt && ids.some((v) => !Number.isSafeInteger(v))) {
                  throw new Error(`${edge.field}: invalid id`);
                }

                if (ids.length > 0) {
                  const inFilter = { op: 'in' as const, field: targetPk, value: ids };
                  const scopeFilter = relConfig?.where ? (relConfig.where({ locals: event.locals }) as any) : undefined;
                  const filter = scopeFilter ? ({ op: 'and', clauses: [inFilter, scopeFilter] } as any) : inFilter;
                  try {
                    const found = await adapter.data.findMany(targetModel, { filter });
                    if (found.length !== new Set(ids.map(String)).size) {
                      throw new Error(`${edge.field}: invalid value`);
                    }
                  } catch (e: any) {
                    if (e?.message?.includes('invalid value')) throw e;
                    // Client incapable de vérifier : on laisse passer.
                  }
                }

                m2mInput[edge.field] = { targetPkField: targetPk, ids };
              }
```

- [ ] **Step 4: Replace the `createRecord`/`updateRecord` calls**

Replace `handler.ts:785-789` with:

```ts
            if (action === 'create') {
              await adapter.data.createRecord(model, { scalars: data, m2m: m2mInput });
            } else if (route.id) {
              await adapter.data.updateRecord(model, route.id, { scalars: data, m2m: m2mInput });
            }
```

`m2mInput` is always defined here (declared at the top of Step 3's replacement, defaulting to `{}` when the model has no m2m edges at all — `relationGraph.edges.values()`'s loop simply never adds a key in that case) — `createRecord`/`updateRecord`'s `input.m2m` being `{}` rather than `undefined` is handled identically by `dataAdapter.ts` (`Object.keys({}).length === 0` takes the no-transaction branch, same as `Object.keys(undefined ?? {}).length === 0`), so no special-casing is needed here.

Remove the now-unused imports at the top of `handler.ts`: `createRecord`, `updateRecord`, `deleteRecord`, `getRecord`, `listRecords` are no longer called from this file at all (Task 6 removed the last `listRecords`/`getRecord` call sites, this task removes the last `createRecord`/`updateRecord`/`deleteRecord` ones). The import block (originally `handler.ts:10-21`) becomes:

```ts
import {
  primaryKeyOf,
  coerceId,
  formDataToPrisma,
  paginate
} from './data.js';
```

`toPrismaModel` is also no longer referenced in `handler.ts` (its last uses were in the now-deleted `loadSelectedIds` and the Task 6 rewrites) — confirm with `grep -n "toPrismaModel" src/lib/server/handler.ts` returning nothing, and leave it out of this import list (it stays exported from `data.ts` for `dataAdapter.ts`'s own import, per Task 4).

- [ ] **Step 5: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/m2mImplicit.test.ts tests/unit/fkEditable.test.ts tests/unit/security.test.ts`
Expected: PASS unmodified — per Task 4's design note, `prisma.$transaction(fn)` in the mock calls `fn(mock)` directly, so `callsTo(prisma, 'post', 'create')`/`callsTo(prisma, 'post', 'update')` still see the exact same `{ data: { ..., tags: { connect/set: [...] } } }` shape as before, whether or not the real call went through a transaction wrapper.

Run: `bun run test`
Expected: PASS in full.

Run: `bun run check`
Expected: PASS — confirm no leftover reference to the deleted `prisma[toPrismaModel(...)]` call sites or unused imports triggers a lint/type error.

Run: `bun run test:coverage`
Expected: 100%.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/handler.ts
git commit -m "refactor: route POST create/update/delete and FK/m2m revalidation through adapter.data"
```

---

## Task 8: Rename `'m2m-implicit'` → `'m2m'`

**Files:**
- Modify: `src/lib/server/introspection/relations.ts:18-22,136-137`
- Modify: `src/lib/server/handler.ts` (5 call sites: lines ~332, 353, 368, 551, 733, plus 3 comments)
- Modify: `src/lib/server/views/Form.svelte:72`
- Modify: `src/lib/server/views/RelationCheckboxes.svelte:20` (comment only)
- Modify: `tests/unit/relations.test.ts` (6 assertions)

**Interfaces:**
- Produces: `RelationKind` now includes `'m2m'` instead of `'m2m-implicit'` — not part of the public API (`RelationKind`/`RelationEdge` aren't re-exported from `src/lib/index.ts`), so this is safe to change without a breaking-change note.

TypeScript's exhaustiveness checking on the `RelationKind` string-literal union means every production call site that still references the old literal will fail `bun run check` immediately after Step 2 — that's the safety net confirming nothing is missed, no need to `grep` production code exhaustively by hand before starting.

- [ ] **Step 1: Baseline**

Run: `bun run test && bun run check`
Expected: PASS (confirms Task 7 landed clean).

- [ ] **Step 2: Rename in `relations.ts`**

In `src/lib/server/introspection/relations.ts`, change line 22 from:

```ts
  | 'm2m-implicit';
```

to:

```ts
  | 'm2m';
```

And line 137 from:

```ts
        kind = 'm2m-implicit';
```

to:

```ts
        kind = 'm2m';
```

- [ ] **Step 3: Run the type checker to find every remaining call site**

Run: `bun run check`
Expected: FAIL, with type errors at every remaining `'m2m-implicit'` comparison against the now-narrower `RelationKind` type (in `handler.ts` and `Form.svelte`). Use the reported file:line list rather than re-deriving it — it's the authoritative, compiler-verified list.

- [ ] **Step 4: Fix `handler.ts`**

Replace every `edge.kind !== 'm2m-implicit'` / `edge.kind === 'm2m-implicit'` occurrence in `src/lib/server/handler.ts` (lines 332, 353, 368, 551, 733 per the grep taken earlier in this planning pass) with the same comparison against `'m2m'`. Also update the three comments referencing "m2m-implicite" (lines 321, 534, 736) to say "m2m" for accuracy — not required for compilation but cheap to keep truthful while touching these lines anyway.

- [ ] **Step 5: Fix `Form.svelte`**

In `src/lib/server/views/Form.svelte:72`, change:

```svelte
            e.kind === 'm2m-implicit' &&
```

to:

```svelte
            e.kind === 'm2m' &&
```

- [ ] **Step 6: Update the comment in `RelationCheckboxes.svelte`**

In `src/lib/server/views/RelationCheckboxes.svelte:20`, change "Fieldset de checkboxes pour une arête m2m-implicite." to "Fieldset de checkboxes pour une arête m2m." — cosmetic only, no compiled code references the string here.

- [ ] **Step 7: Run the type checker again**

Run: `bun run check`
Expected: PASS — zero remaining references to the old literal in production code.

- [ ] **Step 8: Update `relations.test.ts`**

In `tests/unit/relations.test.ts`, replace all 6 occurrences of the string `'m2m-implicit'` with `'m2m'` (lines 55, 56, 211, 227, 228 per the earlier grep — the occurrence at line 114 is a French comment, "m2m-implicit" inside a sentence, update it to "m2m" too for consistency though it doesn't affect the test).

- [ ] **Step 9: Run tests, verify they pass**

Run: `bunx vitest run tests/unit/relations.test.ts`
Expected: PASS.

Run: `bun run test`
Expected: PASS in full — `tests/unit/m2mImplicit.test.ts` and `tests/unit/search.test.ts` never asserted on the literal string (confirmed earlier in this planning pass), only on rendered HTML/behavior, so they're untouched by this rename and should already be green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/server/introspection/relations.ts src/lib/server/handler.ts \
        src/lib/server/views/Form.svelte src/lib/server/views/RelationCheckboxes.svelte \
        tests/unit/relations.test.ts
git commit -m "refactor: rename RelationKind 'm2m-implicit' to 'm2m' (no longer Prisma-specific once other adapters exist)"
```

---

## Task 9: Remove dead code from `data.ts`, finalize the public API

**Files:**
- Modify: `src/lib/server/data.ts` (delete `toPrismaModel`... no — see Step 1; delete `listRecords`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord`)
- Modify: `tests/unit/data.test.ts` (delete the `describe('opérations Prisma', ...)` block covering the removed functions)
- Modify: `src/lib/index.ts` (export `createPrismaAdapter`, `DataAdapter`, `SchemaIntrospector`, `Filter`)
- Modify: `tests/unit/index.test.ts` (extend `RUNTIME_EXPORTS`/`TYPE_ONLY_EXPORTS`)

**Interfaces:**
- Produces: the final public surface for this spec — `createAdminHandler`, `defaultAdminCheck`, `parsePrismaSchema`, `parseSchemaContent`, `createPrismaAdapter` (5 runtime exports); `AdminHandlerConfig`, `PrismaSchema`, `PrismaModel`, `PrismaField`, `Schema`, `Model`, `Field`, `DataAdapter`, `SchemaIntrospector`, `Filter` (10 type-only exports).

- [ ] **Step 1: Confirm what's actually dead**

Run: `grep -rn "from '\./data\.js'" src/lib/server/handler.ts` and `grep -rn "from '\.\./\.\./src/lib/server/data\.js'" tests/`
Expected: `handler.ts` imports only `primaryKeyOf`, `coerceId`, `formDataToPrisma`, `paginate` (confirmed by Task 7, Step 4). `toPrismaModel` should show up only in `adapters/prisma/dataAdapter.ts`'s import and in `tests/unit/data.test.ts`'s own tests for it — keep `toPrismaModel` in `data.ts`, it's still a live, imported pure helper. `listRecords`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord` should show up nowhere outside `data.ts` itself and `tests/unit/data.test.ts`.

- [ ] **Step 2: Delete the dead functions from `data.ts`**

In `src/lib/server/data.ts`, delete `listRecords` (lines 88-114), `getRecord` (116-121), `createRecord` (123-129), `updateRecord` (131-142), `deleteRecord` (144-149) — everything from the `export async function listRecords` line to the end of the file. Keep `toPrismaModel`, `primaryKeyOf`, `coerceId`, `formDataToPrisma`, `paginate` and their doc comments exactly as they are.

- [ ] **Step 3: Trim `tests/unit/data.test.ts`**

Delete the `describe('opérations Prisma', ...)` block (lines 168-239) and its now-unused imports (`listRecords`, `getRecord`, `createRecord`, `updateRecord`, `deleteRecord` from the top `import` statement, and `createPrismaMock`/`callsTo`/`FULL_SCHEMA_PATH` if nothing else in the file still uses them — check the remaining `describe` blocks: `toPrismaModel`, `primaryKeyOf`, `coerceId`, `formDataToPrisma`, `paginate` still need `parsePrismaSchema`/`FULL_SCHEMA_PATH` for the `schema`/`User`/`Post`/`Category` fixtures at the top of the file, so keep those two imports; only `createPrismaMock`/`callsTo` become unused).

- [ ] **Step 4: Run tests to confirm the trim didn't break anything**

Run: `bunx vitest run tests/unit/data.test.ts tests/unit/adapters/prisma/dataAdapter.test.ts`
Expected: PASS — the "opérations Prisma" coverage moved to `dataAdapter.test.ts` in Task 4 already covers the equivalent behavior against the new adapter methods.

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Export the new public API from `index.ts`**

Replace `src/lib/index.ts` in full with:

```ts
/**
 * SvelteKit Admin
 * Django-like admin panel for SvelteKit + Prisma
 */

export { createAdminHandler, type AdminHandlerConfig } from './server/handler.js';
export { defaultAdminCheck } from './server/auth.js';
export {
  parsePrismaSchema,
  parseSchemaContent,
  type PrismaSchema,
  type PrismaModel,
  type PrismaField
} from './server/introspection/parser.js';
export type { Schema, Model, Field } from './server/types/schema.js';
export { createPrismaAdapter } from './server/adapters/prisma/index.js';
export type { DataAdapter, SchemaIntrospector, Filter } from './server/adapters/types.js';
```

- [ ] **Step 6: Update `tests/unit/index.test.ts`**

Replace the `RUNTIME_EXPORTS`/`TYPE_ONLY_EXPORTS` arrays with:

```ts
const RUNTIME_EXPORTS = [
  'createAdminHandler',
  'defaultAdminCheck',
  'parsePrismaSchema',
  'parseSchemaContent',
  'createPrismaAdapter'
] as const;

const TYPE_ONLY_EXPORTS = [
  'AdminHandlerConfig',
  'PrismaSchema',
  'PrismaModel',
  'PrismaField',
  'Schema',
  'Model',
  'Field',
  'DataAdapter',
  'SchemaIntrospector',
  'Filter'
] as const;
```

The existing `it('expose des fonctions réellement utilisables', ...)` test (checking `api.parseSchemaContent(...)`/`api.createAdminHandler(...)`) can stay as-is — it doesn't need to grow a `createPrismaAdapter` assertion to remain meaningful, but add one for completeness and to catch a broken re-export early:

```ts
  it('expose des fonctions réellement utilisables', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(api.parseSchemaContent('model User {\n  id Int @id\n}').models[0].name).toBe('User');
    expect(typeof api.createAdminHandler({ prisma: {}, prismaSchemaPath: '/nope.prisma' })).toBe(
      'function'
    );
    expect(typeof api.createPrismaAdapter({ prisma: {}, schemaPath: '/nope.prisma' }).data.listRecords).toBe(
      'function'
    );
  });
```

- [ ] **Step 7: Run the full suite**

Run: `bun run test:coverage`
Expected: 100%, PASS in full.

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/data.ts tests/unit/data.test.ts src/lib/index.ts tests/unit/index.test.ts
git commit -m "refactor: remove dead Prisma-calling functions from data.ts, export createPrismaAdapter/DataAdapter/SchemaIntrospector/Filter publicly"
```

---

## Task 10: Full regression pass + changeset

**Files:**
- Create: `.changeset/<generated-name>.md`

**Interfaces:** none — this task verifies the previous 9 and records the release note.

- [ ] **Step 1: Full clean-room verification**

Run, in order:

```bash
bun run test:gen
bun run check
bun run lint
bun run test:coverage
```

Expected: all four PASS, coverage report shows 100% on every metric for `src/lib/**`.

- [ ] **Step 2: Confirm the characterization/integration safety net explicitly**

Run: `bunx vitest run tests/characterization/handler.snapshot.test.ts tests/integration/handler.db.test.ts`
Expected: PASS, unmodified since before Task 1 (`git diff main -- tests/characterization tests/integration` should show zero changes to either file across the whole plan — if it shows any, that's a signal behavior drifted somewhere and needs investigating before proceeding, not silencing).

- [ ] **Step 3: Confirm package size / build still works**

Run: `bun run package`
Expected: succeeds, `dist/` builds cleanly with the new `adapters/`/`types/` directories included (nothing in `package.json`'s `files`/`exports` needs to change — `svelte-package` copies the whole `dist` output built from `src/lib`, and `exports` still points `.` at `./dist/index.js`, unaffected by internal file moves).

- [ ] **Step 4: Write the changeset**

This PR adds new public exports (`createPrismaAdapter`, `DataAdapter`, `SchemaIntrospector`, `Filter`, `Schema`, `Model`, `Field`) with zero breaking change to existing behavior — a new capability, not a fix or an internal-only change, so it needs a changeset per `CONTRIBUTING.md`'s SemVer rules (new backward-compatible capability = MINOR).

Create `.changeset/db-adapter-abstraction.md`:

```markdown
---
"sveltekit-admin": minor
---

Extract a generic `SchemaIntrospector`/`DataAdapter` abstraction behind Prisma, exposed as `createPrismaAdapter`. `createAdminHandler({ prisma, prismaSchemaPath })` keeps working exactly as before; `createAdminHandler({ adapter })` is now also available for anyone building a custom or future non-Prisma adapter.
```

- [ ] **Step 5: Commit**

```bash
git add .changeset/db-adapter-abstraction.md
git commit -m "chore: add changeset for the DbAdapter abstraction"
```

---

## Post-plan note (out of scope, do not implement here)

Everything above stops at "Prisma is now one pluggable `DataAdapter`/`SchemaIntrospector` implementation, zero behavior change." Building `createDrizzleAdapter` against these same two interfaces — including how Drizzle's always-explicit m2m pivot tables map onto `RelationEdge.kind`, how `AdminHandlerConfig.models[].relations[field].orderBy`'s currently-Prisma-shaped `Record<string,'asc'|'desc'>` gets interpreted or evolved for a second ORM, and packaging `drizzle-orm` as a separate `sveltekit-admin/adapters/drizzle` subpath export so Prisma-only consumers never need to install it — is the next spec, not a task on this plan.
