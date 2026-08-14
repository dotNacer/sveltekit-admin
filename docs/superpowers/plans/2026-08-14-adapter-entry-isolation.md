# Adapter Entry Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Drizzle-only app can import `createAdminHandler` from `sveltekit-admin/adapters/drizzle` without evaluating `src/lib/server/adapters/prisma/`, while `createAdminHandler({ prisma })` from `sveltekit-admin` stays byte-for-byte the same.

**Architecture:** Split `createAdminHandler` in two. `handler.ts` is ORM-agnostic and requires `adapter`. A new `adapters/prisma/handler.ts` wrapper owns the `{ prisma, prismaSchemaPath, search.mode }` shortcut (graceful degrade on a bad schema path — **not** `createPrismaAdapter`, which throws) and is what the public `.` entry exports. The drizzle subpath re-exports the core factory plus `defaultAdminCheck`.

**Tech Stack:** TypeScript, Vitest, existing `prismaMock.ts` / Drizzle sqlite fixtures. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-adapter-entry-isolation-design.md`

## Global Constraints

- **100% coverage, no exceptions**: `vitest.config.ts` enforces lines/statements/functions/branches at 100% on `src/lib/**`. No `exclude`, no `v8 ignore`.
- **Prisma shortcut does not call `createPrismaAdapter`**: that factory throws on a bad `schemaPath`; the shortcut still degrades to "no models known".
- **`createAdminHandler` stays synchronous.** No `import()`.
- **No `{ drizzle }` shortcut** on the core handler.
- **No new `package.json` exports** (`./core`, `./adapters/prisma`).
- **`RUNTIME_EXPORTS` of `tests/unit/index.test.ts` stays exactly the five current functions.**
- Package manager is **bun**. Single-file: `bunx vitest run <path>`. Full suite: `bun run test`. Types: `bun run check`. Lint: `bun run lint`. Run `bun run test:gen` once in a fresh shell before tests.
- Quote style: single quotes in Prisma/core files (`handler.ts`, `adapters/prisma/**`); double quotes in `adapters/drizzle/index.ts` (match the file).
- Do not commit unless the user explicitly asked — skip every Commit step if they have not.

## File map

| File | Role |
| --- | --- |
| `src/lib/server/handler.ts` | Core factory. `adapter` required. Zero imports from `adapters/prisma/**`. |
| `src/lib/server/adapters/prisma/handler.ts` | Prisma shortcut wrapper. Published by `.`. Must **not** be re-exported from `adapters/prisma/index.ts`. |
| `src/lib/index.ts` | `.` entry: wrapper + existing Prisma public API. |
| `src/lib/server/adapters/drizzle/index.ts` | Re-exports core `createAdminHandler` / `defaultAdminCheck` / generic types. |
| `tests/unit/adapters/prisma/handler.test.ts` | Wrapper boot tests. |
| `tests/unit/adapters/drizzle/isolation.test.ts` | Module-graph pin (drizzle entry must not load prisma adapter files). |
| Prisma unit/integration/characterization tests | Import wrapper, not `handler.ts`. |
| `tests/integration/handler.drizzle.db.test.ts` | Import `createAdminHandler` from the drizzle entry. |
| `README.md`, `.changeset/adapter-entry-isolation.md` | Documented snippet + minor changeset. |

---

### Task 1: Prisma shortcut wrapper

**Files:**
- Create: `src/lib/server/adapters/prisma/handler.ts`
- Create: `tests/unit/adapters/prisma/handler.test.ts`

**Interfaces:**
- Consumes: `createAdminHandler` (core, still currently accepts `{ prisma }` **and** `{ adapter }`), `createPrismaIntrospector`, `createPrismaDataAdapter`, `resolveCaseInsensitiveSearch`.
- Produces: `createAdminHandler(config: AdminHandlerConfig)` and Prisma `AdminHandlerConfig` (`prisma?`, `prismaSchemaPath?`, `adapter?`, `search?`) from `src/lib/server/adapters/prisma/handler.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/adapters/prisma/handler.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';
import { createEvent } from '../../../fixtures/events.js';

afterEach(() => vi.restoreAllMocks());

describe('createAdminHandler — raccourci Prisma', () => {
  it('lève une erreur claire à la création si ni `prisma` ni `adapter` ne sont fournis', () => {
    expect(() => createAdminHandler({} as any)).toThrow(
      /createAdminHandler requires either `prisma`.*or `adapter`/
    );
  });

  it('avertit et rend un admin vide si le schéma est illisible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createAdminHandler({
      prisma: createPrismaMock({}),
      prismaSchemaPath: '/nope.prisma'
    });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(warn).toHaveBeenCalled();
    expect(html).not.toContain('href="/admin/user"');
    expect(html).toContain('<div class="ska-stat__value">0</div>');
  });

  it('avertit aussi quand aucun chemin de schéma n’est fourni', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createAdminHandler({ prisma: createPrismaMock({}) });
    const { event, resolve } = createEvent({ url: '/admin' });
    expect((await handler({ event, resolve } as any)).status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('accepte un adapter fourni directement, sans prismaSchemaPath', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });

  it("boot avec search.mode 'insensitive' reste synchrone et sert la liste", async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const h = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      search: { mode: 'insensitive' }
    });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });
});
```

Do **not** import `createPrismaAdapter` from `./index.js` inside the wrapper later — only the test file does, to build an explicit adapter for the pass-through case.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/adapters/prisma/handler.test.ts`

Expected: FAIL — `Cannot find module` / failed to resolve `adapters/prisma/handler.js`.

- [ ] **Step 3: Implement the wrapper**

Create `src/lib/server/adapters/prisma/handler.ts`. Call the core factory (still in `handler.ts`) **after** building `{ introspector, data }`. On a successful parse, memoize `introspect()` so core does not re-read the file. On parse failure, pass the original introspector through so core performs the existing single `console.warn` degrade. Never call `createPrismaAdapter`.

```ts
import {
  createAdminHandler as createCoreHandler,
  type AdminHandlerConfig as CoreAdminHandlerConfig
} from '../../handler.js';
import type { Schema } from '../../types/schema.js';
import { createPrismaDataAdapter } from './dataAdapter.js';
import { createPrismaIntrospector } from './introspector.js';
import { resolveCaseInsensitiveSearch } from './index.js';

export interface AdminHandlerConfig extends Omit<CoreAdminHandlerConfig, 'adapter'> {
  prisma?: any;
  prismaSchemaPath?: string;
  adapter?: CoreAdminHandlerConfig['adapter'];
  search?: {
    mode?: 'auto' | 'insensitive' | 'default';
  };
}

function omitPrismaShortcutFields(
  config: AdminHandlerConfig
): Omit<AdminHandlerConfig, 'prisma' | 'prismaSchemaPath' | 'search' | 'adapter'> {
  const { prisma: _prisma, prismaSchemaPath: _path, search: _search, adapter: _adapter, ...rest } =
    config;
  return rest;
}

function buildPrismaAdapter(config: AdminHandlerConfig): CoreAdminHandlerConfig['adapter'] {
  const schemaPath = config.prismaSchemaPath ?? './prisma/schema.prisma';
  const introspector = createPrismaIntrospector({ schemaPath });
  let schema: Schema | null = null;
  try {
    schema = introspector.introspect() as Schema;
  } catch {
    schema = null;
  }
  return {
    introspector: schema ? { introspect: () => schema } : introspector,
    data: createPrismaDataAdapter(config.prisma, {
      caseInsensitiveSearch: resolveCaseInsensitiveSearch(schema, config.search?.mode)
    })
  };
}

export function createAdminHandler(config: AdminHandlerConfig) {
  if (config.adapter) {
    return createCoreHandler({ ...omitPrismaShortcutFields(config), adapter: config.adapter });
  }
  if (!config.prisma) {
    throw new Error(
      '[sveltekit-admin] createAdminHandler requires either `prisma` (with optional `prismaSchemaPath`) or `adapter` — neither was provided.'
    );
  }
  return createCoreHandler({
    ...omitPrismaShortcutFields(config),
    adapter: buildPrismaAdapter(config)
  });
}
```

Do **not** re-export this file from `adapters/prisma/index.ts`.

Until Task 4, `CoreAdminHandlerConfig` still has optional `adapter` / `prisma`. The wrapper still type-checks: `Omit<..., 'adapter'>` plus optional `adapter?` is fine. After Task 4, `adapter` becomes required on the core type and this wrapper stays valid.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/adapters/prisma/handler.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/prisma/handler.ts tests/unit/adapters/prisma/handler.test.ts
git commit -m "$(cat <<'EOF'
feat: add Prisma createAdminHandler shortcut wrapper

Isolate the { prisma } boot path in adapters/prisma/handler.ts so the
core factory can later require adapter without changing Prisma DX.
EOF
)"
```

---

### Task 2: Point the public `.` entry at the wrapper

**Files:**
- Modify: `src/lib/index.ts`
- Test: `tests/unit/index.test.ts` (unchanged assertions)

**Interfaces:**
- Consumes: `createAdminHandler` / `AdminHandlerConfig` from `adapters/prisma/handler.ts`.
- Produces: same five runtime exports as today; `createAdminHandler` is now the wrapper.

- [ ] **Step 1: Write the failing assertion**

`tests/unit/index.test.ts` already calls `api.createAdminHandler({ prisma: {}, prismaSchemaPath: '/nope.prisma' })`. That will keep passing while `.` still re-exports core. Add this to the existing `'expose des fonctions réellement utilisables'` test, after the `createPrismaAdapter` assertion:

```ts
    const wrapped = api.createAdminHandler({
      prisma: {},
      prismaSchemaPath: '/nope.prisma'
    });
    expect(typeof wrapped).toBe('function');
```

That is redundant with the existing assertion. Instead, pin the **source** of the export. Add a new test in `tests/unit/index.test.ts`:

```ts
  it('createAdminHandler est le wrapper Prisma, pas le core', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/lib/index.ts', import.meta.url), 'utf8')
    );
    expect(src).toContain("from './server/adapters/prisma/handler.js'");
    expect(src).not.toMatch(
      /export \{ createAdminHandler.*\} from '\.\/server\/handler\.js'/
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/index.test.ts -t "wrapper Prisma"`

Expected: FAIL — `index.ts` still exports from `./server/handler.js`.

- [ ] **Step 3: Switch the barrel**

In `src/lib/index.ts`, replace:

```ts
export { createAdminHandler, type AdminHandlerConfig } from './server/handler.js';
```

with:

```ts
export { createAdminHandler, type AdminHandlerConfig } from './server/adapters/prisma/handler.js';
```

Leave every other export untouched (`defaultAdminCheck`, `parsePrismaSchema`, `createPrismaAdapter`, types).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/index.test.ts`

Expected: PASS. `RUNTIME_EXPORTS` still exactly those five functions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/index.ts tests/unit/index.test.ts
git commit -m "$(cat <<'EOF'
fix: export Prisma createAdminHandler wrapper from package root

The public sveltekit-admin entry now owns the { prisma } shortcut so
Drizzle can later import the core factory from a separate subpath.
EOF
)"
```

---

### Task 3: Retarget Prisma tests at the wrapper

**Files (import line only — change `handler.js` → `adapters/prisma/handler.js`, adjust relative depth):**

- `tests/characterization/handler.snapshot.test.ts`
- `tests/integration/handler.db.test.ts`
- `tests/integration/handler.m2m.db.test.ts`
- `tests/unit/handler.test.ts`
- `tests/unit/listFilters.test.ts`
- `tests/unit/fkEditable.test.ts`
- `tests/unit/security.test.ts`
- `tests/unit/fkFilters.test.ts`
- `tests/unit/uniqueFieldSearchRegression.test.ts`
- `tests/unit/m2mImplicit.test.ts`
- `tests/unit/ignoredFilters.test.ts`
- `tests/unit/relatedAndFilter.test.ts`
- `tests/unit/logout.test.ts`
- `tests/unit/search.test.ts`
- `tests/unit/searchFilterHidden.test.ts`

Do **not** change `tests/integration/handler.drizzle.db.test.ts` in this task.

**Depth:** files under `tests/unit/` and `tests/characterization/` and `tests/integration/` currently import `../../src/lib/server/handler.js`. New path: `../../src/lib/server/adapters/prisma/handler.js`.

**Interfaces:**
- Consumes: wrapper `createAdminHandler`.
- Produces: Prisma tests exercise the published shortcut. `handler.test.ts` still contains the three boot tests that now duplicate Task 1 — delete those three from `handler.test.ts` in this task (they live in `tests/unit/adapters/prisma/handler.test.ts`).

- [ ] **Step 1: Write the failing cut**

In `tests/unit/handler.test.ts`, **delete** these three tests (moved in Task 1):

1. `'lève une erreur claire à la création si ni \`prisma\` ni \`adapter\` ne sont fournis'`
2. `'avertit et rend un admin vide si le schéma est illisible'`
3. `'avertit aussi quand aucun chemin de schéma n’est fourni'`

Keep `'accepte un adapter fourni directement, sans prismaSchemaPath'` and the async-introspector test in `handler.test.ts` for now (they still import whatever `createAdminHandler` this file uses).

Change the import at the top of `tests/unit/handler.test.ts` to the wrapper **before** running, together with every other file in the list:

```ts
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
```

This step is mechanical. The "failing test" is: if you change only `handler.test.ts` and forget the others, `bunx vitest run tests/unit/handler.test.ts` still passes. The real red is Task 4. This task is the prerequisite so Task 4 does not explode the suite.

- [ ] **Step 2: Apply the import rewrite**

For each file in the list, replace:

```ts
import { createAdminHandler } from '../../src/lib/server/handler.js';
```

with:

```ts
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
```

In `tests/unit/handler.test.ts`, after switching the import, delete the three boot tests listed in Step 1. Update the remaining `'accepte un adapter fourni directement'` test to pass `{ adapter }` only (drop the extra `prisma:` key — the wrapper pass-through must not require it):

```ts
    const h = createAdminHandler({ adapter } as any);
```

The async-introspector test can keep `prisma` in the object (`as any`) until Task 4; optional cleanup: drop `prisma` there too, keep `adapter`.

- [ ] **Step 3: Run the Prisma unit + characterization files**

Run:

```bash
bunx vitest run tests/unit/handler.test.ts tests/unit/adapters/prisma/handler.test.ts tests/characterization/handler.snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/characterization/handler.snapshot.test.ts tests/integration/handler.db.test.ts tests/integration/handler.m2m.db.test.ts tests/unit/handler.test.ts tests/unit/listFilters.test.ts tests/unit/fkEditable.test.ts tests/unit/security.test.ts tests/unit/fkFilters.test.ts tests/unit/uniqueFieldSearchRegression.test.ts tests/unit/m2mImplicit.test.ts tests/unit/ignoredFilters.test.ts tests/unit/relatedAndFilter.test.ts tests/unit/logout.test.ts tests/unit/search.test.ts tests/unit/searchFilterHidden.test.ts
git commit -m "$(cat <<'EOF'
test: point Prisma handler tests at the shortcut wrapper

Keep { prisma } coverage on the published factory so the core can
require adapter without rewriting every assertion.
EOF
)"
```

---

### Task 4: Core handler requires `adapter`

**Files:**
- Modify: `src/lib/server/handler.ts` (imports, `AdminHandlerConfig`, boot block)
- Modify: `tests/unit/handler.test.ts` (add a core-import describe, or new file below)
- Test: `tests/unit/handler.core.test.ts` (create)

**Interfaces:**
- Consumes: `config.adapter` only.
- Produces: `createAdminHandler(config: AdminHandlerConfig)` where `adapter` is required; throw `[sveltekit-admin] createAdminHandler requires \`adapter\`.` Zero imports from `adapters/prisma/**`. `search` / `prisma` / `prismaSchemaPath` removed from the core type.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/handler.core.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

afterEach(() => vi.restoreAllMocks());

describe('createAdminHandler — core', () => {
  it('lève une erreur si `adapter` est absent', () => {
    expect(() => createAdminHandler({} as any)).toThrow(
      /createAdminHandler requires `adapter`/
    );
  });

  it('ignore un `prisma` fourni sans adapter (toujours throw adapter)', () => {
    expect(() =>
      createAdminHandler({ prisma: createPrismaMock({}), prismaSchemaPath: FULL_SCHEMA_PATH } as any)
    ).toThrow(/createAdminHandler requires `adapter`/);
  });

  it('accepte un adapter seul, sans prisma', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/handler.core.test.ts`

Expected: FAIL — `({ prisma })` still boots (does not throw `requires \`adapter\``). The empty-config test currently throws the *wrapper* message (`prisma` or `adapter`) if this file accidentally imported the wrapper; it imports core, so today empty config throws the prisma-or-adapter message. Assert the new message so it fails until Task 4 Step 3.

- [ ] **Step 3: Strip Prisma from `handler.ts`**

Remove these imports:

```ts
import { createPrismaIntrospector } from './adapters/prisma/introspector.js';
import { createPrismaDataAdapter } from './adapters/prisma/dataAdapter.js';
import { resolveCaseInsensitiveSearch } from './adapters/prisma/index.js';
```

On `AdminHandlerConfig`:

- Delete fields `prisma`, `prismaSchemaPath`, and `search`.
- Make `adapter` required:

```ts
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
```

Rewrite the JSDoc on `adapter` to: explicit `{ introspector, data }` (from `createPrismaAdapter` / `createDrizzleAdapter` / custom). The `{ prisma }` shortcut lives on the Prisma wrapper, not here.

In `createAdminHandler`, delete `prisma` / `prismaSchemaPath` from the destructure. Replace the boot guard + introspector fallback + `caseInsensitiveSearch` + adapter fallback with:

```ts
  if (!config.adapter) {
    throw new Error('[sveltekit-admin] createAdminHandler requires `adapter`.');
  }

  const introspector: SchemaIntrospector = config.adapter.introspector;
```

and later, replace:

```ts
  const caseInsensitiveSearch = resolveCaseInsensitiveSearch(schema, config.search?.mode);

  const adapter: { introspector: SchemaIntrospector; data: DataAdapter } =
    config.adapter ?? { introspector, data: createPrismaDataAdapter(prisma, { caseInsensitiveSearch }) };
```

with:

```ts
  const adapter = config.adapter;
```

Leave the introspect try/catch, relation graph, listFilter validation, and the rest of the request pipeline untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bunx vitest run tests/unit/handler.core.test.ts tests/unit/handler.test.ts tests/unit/adapters/prisma/handler.test.ts tests/unit/index.test.ts
```

Expected: PASS. Core throws `requires \`adapter\``. Wrapper still throws `requires either \`prisma\` … or \`adapter\``. `{ prisma }` via wrapper still degrades on `/nope.prisma`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/handler.ts tests/unit/handler.core.test.ts
git commit -m "$(cat <<'EOF'
refactor: require adapter in the core createAdminHandler

Stop importing the Prisma adapter from handler.ts so a Drizzle-only
entry can load the admin core without evaluating adapters/prisma.
EOF
)"
```

---

### Task 5: Drizzle subpath re-exports + isolation pin

**Files:**
- Modify: `src/lib/server/adapters/drizzle/index.ts`
- Modify: `tests/unit/adapters/drizzle/index.test.ts`
- Create: `tests/unit/adapters/drizzle/isolation.test.ts`
- Modify: `tests/integration/handler.drizzle.db.test.ts` (import line)

**Interfaces:**
- Consumes: core `createAdminHandler` / `AdminHandlerConfig` from `handler.ts`, `defaultAdminCheck` from `auth.ts`.
- Produces: drizzle subpath runtime exports `createAdminHandler`, `defaultAdminCheck`, `createDrizzleAdapter` (and existing `resolveCaseInsensitiveSearch` — already a runtime export of this module; do not remove it, it is not part of the public README but tests import it). Type-only: `AdminHandlerConfig`, `DrizzleDialect`, `Schema`, `Model`, `Field`, `DataAdapter`, `SchemaIntrospector`, `Filter`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/adapters/drizzle/index.test.ts` (keep existing tests):

```ts
import * as drizzleApi from "../../../../src/lib/server/adapters/drizzle/index.js";
import { defaultAdminCheck } from "../../../../src/lib/server/auth.js";

describe("surface publique sveltekit-admin/adapters/drizzle", () => {
  it("exporte createAdminHandler, createDrizzleAdapter et defaultAdminCheck", () => {
    expect(typeof drizzleApi.createAdminHandler).toBe("function");
    expect(typeof drizzleApi.createDrizzleAdapter).toBe("function");
    expect(typeof drizzleApi.defaultAdminCheck).toBe("function");
    expect(drizzleApi.defaultAdminCheck).toBe(defaultAdminCheck);
  });

  it("n’exporte pas createPrismaAdapter", () => {
    expect("createPrismaAdapter" in drizzleApi).toBe(false);
  });
});
```

Create `tests/unit/adapters/drizzle/isolation.test.ts` as its **own file** so `vi.mock` cannot leak (Vitest isolates module cache per file):

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/server/adapters/prisma/index.js", () => {
  throw new Error("prisma adapter index loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/handler.js", () => {
  throw new Error("prisma handler loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/dataAdapter.js", () => {
  throw new Error("prisma dataAdapter loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/introspector.js", () => {
  throw new Error("prisma introspector loaded");
});
vi.mock("../../../../src/lib/server/adapters/prisma/filterCompiler.js", () => {
  throw new Error("prisma filterCompiler loaded");
});

describe("isolation du sous-chemin drizzle", () => {
  it("importe le sous-chemin sans évaluer adapters/prisma", async () => {
    const mod = await import("../../../../src/lib/server/adapters/drizzle/index.js");
    expect(typeof mod.createAdminHandler).toBe("function");
    expect(typeof mod.createDrizzleAdapter).toBe("function");
    expect(typeof mod.defaultAdminCheck).toBe("function");
  });
});
```

In `tests/integration/handler.drizzle.db.test.ts`, change:

```ts
import { createDrizzleAdapter } from '../../src/lib/server/adapters/drizzle/index.js';
import { createAdminHandler } from '../../src/lib/server/handler.js';
```

to:

```ts
import { createAdminHandler, createDrizzleAdapter } from '../../src/lib/server/adapters/drizzle/index.js';
```

(That last change will fail to type-check until Step 3 re-exports `createAdminHandler`. Runtime currently would fail on named export.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/adapters/drizzle/index.test.ts tests/unit/adapters/drizzle/isolation.test.ts tests/integration/handler.drizzle.db.test.ts`

Expected: FAIL — `createAdminHandler` / `defaultAdminCheck` are undefined on the drizzle module. Isolation test may already pass (core still imported prisma until Task 4; **after Task 4** isolation should be the real pin). If Task 4 is done, isolation already passes before re-exports; the surface test is the red.

- [ ] **Step 3: Re-export from the drizzle entry**

At the **top** of `src/lib/server/adapters/drizzle/index.ts` (imports at top of file), add:

```ts
export { createAdminHandler, type AdminHandlerConfig } from "../../handler.js";
export { defaultAdminCheck } from "../../auth.js";
export type { Schema, Model, Field } from "../../types/schema.js";
export type { DataAdapter, SchemaIntrospector, Filter } from "../types.js";
```

Keep existing `createDrizzleAdapter` / `DrizzleDialect` / `resolveCaseInsensitiveSearch`. Use double quotes to match this file.

Do not import anything from `../prisma/` or from `../../../index.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/adapters/drizzle/index.test.ts tests/unit/adapters/drizzle/isolation.test.ts tests/integration/handler.drizzle.db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/drizzle/index.ts tests/unit/adapters/drizzle/index.test.ts tests/unit/adapters/drizzle/isolation.test.ts tests/integration/handler.drizzle.db.test.ts
git commit -m "$(cat <<'EOF'
feat: re-export createAdminHandler from the Drizzle adapter entry

A Drizzle-only app can import handler and adapter from one subpath
without evaluating the Prisma adapter modules.
EOF
)"
```

---

### Task 6: README + changeset

**Files:**
- Modify: `README.md` (Drizzle section)
- Create: `.changeset/adapter-entry-isolation.md`

**Interfaces:**
- Produces: documented one-import Drizzle snippet; minor changelog entry.

- [ ] **Step 1: Write the failing doc pin (optional but keeps README honest)**

No automated README test exists. Skip a test; edit README directly. This task is documentation + changeset, which the coverage gate does not require a red test for (no `src/lib` change).

- [ ] **Step 2: Update README**

Replace the Drizzle section (from `## Drizzle` through the snippet and the sentence about `config.search.mode`) with:

```md
## Drizzle

Prisma stays the default on the root entry (`createAdminHandler({ prisma })`).
For Drizzle, import **both** the handler and the adapter from the subpath
so a Drizzle-only app never evaluates the Prisma adapter modules:

```typescript
import { createAdminHandler, createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';

export const handle = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: (event) => event.locals.session?.user?.role === 'admin'
});
```

Importing `createAdminHandler` from `sveltekit-admin` and the adapter from
the subpath still works, but it loads the Prisma adapter JavaScript (it does
not require installing `@prisma/client`).

Pass the same `schema` object you already export (tables + `relations()`).
Model names in `config.models` are the JS export keys (`users`, not `User`).
`config.search.mode` only applies to `createAdminHandler({ prisma })`;
pass `searchMode` to `createDrizzleAdapter` instead. Nested Prisma `where`
objects in `listWhere` are not supported — use a flat `{ tenantId: 1 }` or
a `Filter` AST.
```

Leave the m2m sqlite paragraph that follows unchanged.

- [ ] **Step 3: Add the changeset**

Create `.changeset/adapter-entry-isolation.md`:

```md
---
"sveltekit-admin": minor
---

Re-export `createAdminHandler` and `defaultAdminCheck` from `sveltekit-admin/adapters/drizzle`, so a Drizzle-only app can import the handler and `createDrizzleAdapter` from one subpath without evaluating the Prisma adapter modules. `createAdminHandler({ prisma })` from `sveltekit-admin` is unchanged; importing the handler from the root entry plus the Drizzle adapter from the subpath still works, but that path keeps loading the Prisma adapter JavaScript.
```

Minor, not patch: new public runtime exports on the drizzle subpath. Not major: the old two-import snippet still compiles.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/adapter-entry-isolation.md
git commit -m "$(cat <<'EOF'
docs: recommend a single Drizzle import path

Document the adapters/drizzle re-export so Drizzle-only apps do not
pull in the Prisma adapter graph.
EOF
)"
```

---

### Task 7: Full suite + types

**Files:** none new.

- [ ] **Step 1: Typecheck**

Run: `bun run check`

Expected: PASS. If `AdminHandlerConfig` split breaks a test that is not `as any`, fix the test to import the Prisma wrapper type or pass `adapter`.

- [ ] **Step 2: Full test + coverage**

Run: `bun run test:coverage`

Expected: PASS, 100% lines/statements/functions/branches on `src/lib/**`. If `omitPrismaShortcutFields` unused bindings or the `schema = null` catch are uncovered, add a focused test in `tests/unit/adapters/prisma/handler.test.ts` rather than defensive code.

- [ ] **Step 3: Lint**

Run: `bun run lint`

Expected: PASS. Underscore-prefixed unused destructure bindings (`_prisma`, …) must satisfy eslint; if `no-unused-vars` still flags them, omit via rest only and void-assign nothing — the current pattern with `_` prefix matches typical `@typescript-eslint/no-unused-vars` ignore.

- [ ] **Step 4: Commit** (only if Step 2/3 required extra test/lint fixes)

```bash
git add -u
git commit -m "$(cat <<'EOF'
test: cover adapter-entry isolation branches at 100%

Close coverage gaps on the Prisma wrapper boot paths found by the
full suite.
EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Core requires `adapter`, no `adapters/prisma` imports | 4 |
| Wrapper owns `{ prisma }` + graceful degrade, not `createPrismaAdapter` | 1 |
| `.` exports wrapper; `RUNTIME_EXPORTS` unchanged | 2 |
| Prisma tests import wrapper | 3 |
| Drizzle subpath re-exports handler + `defaultAdminCheck` + generic types | 5 |
| Isolation: importing drizzle must not evaluate `adapters/prisma` | 5 |
| Drizzle integration uses published entry | 5 |
| README one-import snippet; old two-import still documented as working | 6 |
| Changeset minor | 6 |
| 100% coverage / check / lint | 7 |
| No `./core` or `./adapters/prisma` export | (none added) |
| No `{ drizzle }` shortcut, no dynamic `import()` | (none added) |

## Placeholder / type-consistency scan

- Wrapper and core share the name `createAdminHandler` / `AdminHandlerConfig` on purpose (two modules). Core type after Task 4: `adapter` required, no `prisma`/`search`. Prisma type: optional `prisma`/`adapter`/`search`.
- Throw strings are exact: core `` requires `adapter` ``; wrapper keeps the current `prisma` or `adapter` sentence.
- `resolveCaseInsensitiveSearch` in the wrapper is the Prisma one from `adapters/prisma/index.ts`, not the Drizzle helper of the same name.
