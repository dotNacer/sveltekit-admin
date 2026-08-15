# Admin Plugin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `plugins?: AdminPlugin[]` API on `createAdminHandler` (pages + record actions + inline CSS/JS), wired through the PR 1 runtime/router/slots, validated by a fake test plugin — not the graph plugin.

**Architecture:** `createAdminRuntime` stays schema boot. `resolvePluginRegistry` validates plugins at handler creation and builds a route table matched *before* `BUILTIN_ROUTES` (identical overlays still throw at boot; a literal token in a `:model`/`:id` position can shadow a builtin view). The handler dispatches plugin GET pages (405 otherwise), preloads `:id` via scoped `loadRecord`, and fills Layout/Form/List slots. Reads go through `pluginAccess` (no `adapter` on the public ctx).

**Tech Stack:** TypeScript, Svelte 5 SSR, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-admin-plugin-api-design.md`

## Global Constraints

- **100% coverage, no exceptions**: `vitest.config.ts` enforces lines/statements/functions/branches at 100% on `src/lib/**`. No `exclude`, no `v8 ignore`.
- **Package manager is pnpm.** Single-file: `pnpm exec vitest run <path>`. Full suite: `pnpm run test`. Types: `pnpm run check`. Run `pnpm run test:gen` once in a fresh shell before tests if `tests/fixtures/prisma/client/` is missing.
- Quote style: single quotes, match `handler.ts`.
- `matchRoute` still captures **only** `:model` and `:id`. No `startsWith(':')`.
- Layout `extraStyles` stays concatenated into the theme `{@html}` (byte-identical when `''`). Do not add a sibling `{#if}`.
- Direct `render(Layout/Form)` in tests: `config as any` (`AdminHandlerConfig` requires `adapter`).
- Core `createAdminHandler` requires `adapter`; `{ prisma }` is the Prisma wrapper. Both must accept `plugins`.
- Do **not** export `createAdminRuntime` / `AdminRuntime` / `matchRoute` / `resolvePluginRegistry`.
- Do **not** implement the relation-graph plugin, JSON endpoints, nav, CRUD intercept, or `sveltekit-admin/plugins/...`.
- Do **not** scope builtin edit/delete/`getRecord`.
- Changeset **minor** (new config field + new type exports).
- Do not commit unless the user explicitly asked — skip every Commit step if they have not.
- Worktree isolation (session brief): execute from a fresh worktree on `origin/main` (`feat/admin-plugin-api`), not `feat/admin-runtime-extraction`. Copy this plan + the spec into the worktree if they are not on `main` yet.

## File map

| File | Role |
| --- | --- |
| `src/lib/server/plugin.ts` | Public types only (`AdminPlugin`, pages, actions, ctx, result). |
| `src/lib/server/pluginRegistry.ts` | Boot validate, `RouteEntry[]`, `pagesByView`, concat actions. |
| `src/lib/server/pluginAccess.ts` | Scoped `loadRecord` / `listRecords` / `getM2mSelectedIds` + ctx factory. |
| `src/lib/server/runtime.ts` | Add `listScopeFrom` (extract `{}` throw from handler list GET). |
| `src/lib/server/handler.ts` | `plugins?` on config; `matchRoute` concat; plugin GET; fill slots. |
| `src/lib/server/adapters/prisma/handler.ts` | Re-export plugin types (field inherited via `Omit`). |
| `src/lib/server/adapters/drizzle/index.ts` | Re-export plugin types. |
| `src/lib/index.ts` | Export plugin types. |
| `tests/fixtures/fakeGraphPlugin.ts` | Test-only fake plugin. |
| `tests/unit/pluginRegistry.test.ts` | Boot collisions / overlay / models. |
| `tests/unit/pluginAccess.test.ts` | Helpers sécu. |
| `tests/unit/handler.plugins.test.ts` | HTTP wiring. |
| `tests/unit/index.test.ts` | `TYPE_ONLY_EXPORTS` + source export. |
| `docs/src/lib/content/docs/plugins.svx` | Consumer docs. |
| `docs/src/lib/config/navigation.ts` | Nav entry. |
| `docs/src/lib/content/docs/configuration-reference.svx` | `plugins` row. |
| `docs/src/lib/content/docs/how-it-works.svx` | One sentence + link. |
| `README.md` | Feature bullet + short Plugins section. |
| `CLAUDE.md` | Request flow + new security invariants. |
| `.changeset/admin-plugin-api.md` | Minor. |

---

### Task 1: Public types, `plugins?` config, package exports

**Files:**
- Create: `src/lib/server/plugin.ts`
- Modify: `src/lib/server/handler.ts` (`AdminHandlerConfig` only)
- Modify: `src/lib/index.ts`
- Modify: `src/lib/server/adapters/prisma/handler.ts`
- Modify: `src/lib/server/adapters/drizzle/index.ts`
- Test: `tests/unit/index.test.ts`

**Interfaces:**
- Consumes: existing `Model`, `Filter`, `RelationGraph` public types.
- Produces: types in `plugin.ts` (exact names later tasks import). Config field `plugins?: AdminPlugin[]` on core `AdminHandlerConfig`. Type-only re-exports from `.`, Prisma wrapper, and `sveltekit-admin/adapters/drizzle`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/index.test.ts`, extend the comment list and `TYPE_ONLY_EXPORTS`:

```ts
const TYPE_ONLY_EXPORTS = [
  'AdminHandlerConfig',
  'AdminPlugin',
  'AdminPluginPage',
  'AdminPluginRecordAction',
  'PluginPageContext',
  'PluginPageResult',
  'AuditAction',
  'AuditEvent',
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

In the existing `createAdminHandler est le wrapper Prisma` describe, add:

```ts
  it('exporte les types AdminPlugin depuis plugin.ts', () => {
    const src = readFileSync(new URL('../../src/lib/index.ts', import.meta.url), 'utf8');
    expect(src).toContain("from './server/plugin.js'");
    expect(src).toMatch(/AdminPlugin/);
    expect(src).toMatch(/PluginPageContext/);
  });
```

In `tests/unit/adapters/drizzle/index.test.ts`, inside `describe("surface publique sveltekit-admin/adapters/drizzle")`, add:

```ts
  it("réexporte les types AdminPlugin", () => {
    const src = readFileSync(
      new URL("../../../../src/lib/server/adapters/drizzle/index.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/AdminPlugin/);
    expect(src).toMatch(/PluginPageContext/);
  });
```

(`readFileSync` is already imported in the drizzle test file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/index.test.ts tests/unit/adapters/drizzle/index.test.ts`

Expected: FAIL — `index.ts` has no `plugin.js` import; drizzle index has no `AdminPlugin`.

- [ ] **Step 3: Add types, config field, exports**

Create `src/lib/server/plugin.ts`:

```ts
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
```

In `src/lib/server/handler.ts`, add:

```ts
import type { AdminPlugin } from './plugin.js';
```

Inside `AdminHandlerConfig`, after `branding?: { ... };`:

```ts
  /**
   * Optional admin plugins (new pages + record actions). Omitted or `[]`
   * keeps every builtin view byte-identical to a build without plugins.
   * See `AdminPlugin`. Options like graph `depth` belong on the author's
   * factory, not here.
   */
  plugins?: AdminPlugin[];
```

`src/lib/index.ts` — add next to the existing type exports:

```ts
export type {
  AdminPlugin,
  AdminPluginPage,
  AdminPluginRecordAction,
  PluginPageContext,
  PluginPageResult
} from './server/plugin.js';
```

`src/lib/server/adapters/prisma/handler.ts` — add:

```ts
export type {
  AdminPlugin,
  AdminPluginPage,
  AdminPluginRecordAction,
  PluginPageContext,
  PluginPageResult
} from '../../plugin.js';
```

`src/lib/server/adapters/drizzle/index.ts` — add (keep that file's existing double-quote style):

```ts
export type {
  AdminPlugin,
  AdminPluginPage,
  AdminPluginRecordAction,
  PluginPageContext,
  PluginPageResult,
} from "../../plugin.js";
```

Do not read `config.plugins` in the handler yet.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/index.test.ts tests/unit/adapters/drizzle/index.test.ts tests/unit/handler.core.test.ts tests/unit/handler.test.ts`

Expected: PASS. `RUNTIME_EXPORTS` still exactly five functions. Characterization not required yet (no dispatch change).

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/plugin.ts src/lib/server/handler.ts src/lib/index.ts src/lib/server/adapters/prisma/handler.ts src/lib/server/adapters/drizzle/index.ts tests/unit/index.test.ts tests/unit/adapters/drizzle/index.test.ts
git commit -m "$(cat <<'EOF'
feat: export AdminPlugin types and plugins config field

EOF
)"
```

---

### Task 2: Plugin registry (boot validation + route table)

**Files:**
- Create: `src/lib/server/pluginRegistry.ts`
- Test: `tests/unit/pluginRegistry.test.ts`

**Interfaces:**
- Consumes: `AdminPlugin` / `AdminPluginPage` / `AdminPluginRecordAction` from Task 1; `RouteEntry` / `BUILTIN_ROUTES` from `router.ts`.
- Produces:

```ts
export interface PluginRegistry {
  routes: RouteEntry[];
  pagesByView: Map<string, AdminPluginPage>;
  recordActions: AdminPluginRecordAction[];
}

export function pluginViewId(pluginName: string, pattern: string[]): string;
// `plugin/${name}/${pattern.join('/')}` — e.g. plugin/fake-graph/:model/:id/graph

export function resolvePluginRegistry(
  plugins: AdminPlugin[],
  builtinRoutes: RouteEntry[],
  visibleModels: Array<{ name: string }>
): PluginRegistry;

export function actionsForModel(
  registry: PluginRegistry,
  modelName: string
): AdminPluginRecordAction[];
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pluginRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_ROUTES } from '../../src/lib/server/router.js';
import {
  resolvePluginRegistry,
  actionsForModel,
  pluginViewId
} from '../../src/lib/server/pluginRegistry.js';
import type { AdminPlugin } from '../../src/lib/server/plugin.js';

const models = [{ name: 'User' }, { name: 'Post' }];

const page = (over: Partial<AdminPlugin> = {}): AdminPlugin => ({
  name: 'fake-graph',
  pages: [{ pattern: [':model', ':id', 'graph'], render: async () => ({ html: 'x' }) }],
  ...over
});

describe('pluginViewId', () => {
  it('joins name and pattern', () => {
    expect(pluginViewId('fake-graph', [':model', ':id', 'graph'])).toBe(
      'plugin/fake-graph/:model/:id/graph'
    );
  });
});

describe('resolvePluginRegistry', () => {
  it('registre vide si plugins = []', () => {
    const reg = resolvePluginRegistry([], BUILTIN_ROUTES, models);
    expect(reg.routes).toEqual([]);
    expect(reg.pagesByView.size).toBe(0);
    expect(reg.recordActions).toEqual([]);
  });

  it('enregistre une page après les builtins (ordre plugins puis pages)', () => {
    const a: AdminPlugin = {
      name: 'a',
      pages: [{ pattern: [':model', ':id', 'graph'], render: async () => ({ html: 'a' }) }]
    };
    const b: AdminPlugin = {
      name: 'b',
      pages: [{ pattern: ['hello'], render: async () => ({ html: 'b' }) }]
    };
    const reg = resolvePluginRegistry([a, b], BUILTIN_ROUTES, models);
    expect(reg.routes.map((r) => r.view)).toEqual([
      pluginViewId('a', [':model', ':id', 'graph']),
      pluginViewId('b', ['hello'])
    ]);
    expect(reg.pagesByView.get(pluginViewId('a', [':model', ':id', 'graph']))).toBe(a.pages![0]);
  });

  it('concatène recordActions dans l’ordre plugins puis interne', () => {
    const a: AdminPlugin = {
      name: 'a',
      recordActions: [
        { label: 'A1', href: () => '/a1' },
        { label: 'A2', href: () => '/a2' }
      ]
    };
    const b: AdminPlugin = {
      name: 'b',
      recordActions: [{ label: 'B1', href: () => '/b1' }]
    };
    const reg = resolvePluginRegistry([a, b], BUILTIN_ROUTES, models);
    expect(reg.recordActions.map((x) => x.label)).toEqual(['A1', 'A2', 'B1']);
  });

  it('throw si name vide', () => {
    expect(() => resolvePluginRegistry([{ name: '', pages: [] }], BUILTIN_ROUTES, models)).toThrow(
      /plugin name must be a non-empty string/
    );
  });

  it('throw si name dupliqué', () => {
    expect(() =>
      resolvePluginRegistry([page({ name: 'x' }), page({ name: 'x' })], BUILTIN_ROUTES, models)
    ).toThrow(/duplicate plugin name "x"/);
  });

  it.each([
    { pattern: [] as string[], label: 'dashboard' },
    { pattern: ['_search'], label: '_search' },
    { pattern: ['_logout'], label: '_logout' },
    { pattern: [':model'], label: 'list' },
    { pattern: [':model', 'new'], label: 'create' },
    { pattern: [':model', ':id'], label: 'edit' }
  ])('throw overlay builtin $label', ({ pattern }) => {
    expect(() =>
      resolvePluginRegistry(
        [{ name: 'x', pages: [{ pattern, render: async () => ({ html: '' }) }] }],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/overlays builtin route/);
  });

  it('throw collision de pattern entre deux plugins', () => {
    const p = [':model', ':id', 'graph'];
    expect(() =>
      resolvePluginRegistry(
        [
          { name: 'one', pages: [{ pattern: p, render: async () => ({ html: '1' }) }] },
          { name: 'two', pages: [{ pattern: p, render: async () => ({ html: '2' }) }] }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/collides with plugin "one"/);
  });

  it('throw collision de pattern dans le même plugin', () => {
    const p = [':model', ':id', 'graph'];
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'one',
            pages: [
              { pattern: p, render: async () => ({ html: '1' }) },
              { pattern: p, render: async () => ({ html: '2' }) }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/collides with plugin "one"/);
  });

  it('throw token :foo', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: [':model', ':id', ':foo'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/":foo" is not :model or :id/);
  });

  it('throw models[] inconnu sur une page', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [
              {
                pattern: [':model', ':id', 'graph'],
                models: ['Nope'],
                render: async () => ({ html: '' })
              }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/unknown model "Nope"/);
  });

  it('throw models[] inconnu sur une action', () => {
    expect(() =>
      resolvePluginRegistry(
        [{ name: 'x', recordActions: [{ label: 'G', models: ['Nope'], href: () => '/' }] }],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/unknown model "Nope"/);
  });

  it('accepte models[] insensible à la casse', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [
              {
                pattern: [':model', ':id', 'graph'],
                models: ['user'],
                render: async () => ({ html: '' })
              }
            ]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).not.toThrow();
  });

  it('throw models[] sur une page sans :model', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: ['hello'], models: ['User'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/sets models\[\] but pattern has no :model/);
  });

  it('throw :id sans :model', () => {
    expect(() =>
      resolvePluginRegistry(
        [
          {
            name: 'x',
            pages: [{ pattern: ['hello', ':id'], render: async () => ({ html: '' }) }]
          }
        ],
        BUILTIN_ROUTES,
        models
      )
    ).toThrow(/:id but pattern has no :model/);
  });

  it('plugin no-op (ni pages ni actions) est autorisé', () => {
    expect(() => resolvePluginRegistry([{ name: 'noop' }], BUILTIN_ROUTES, models)).not.toThrow();
  });
});

describe('actionsForModel', () => {
  it('filtre par models[] insensible à la casse ; omit = tous', () => {
    const reg = resolvePluginRegistry(
      [
        {
          name: 'x',
          recordActions: [
            { label: 'All', href: () => '/all' },
            { label: 'User only', models: ['user'], href: () => '/u' },
            { label: 'Post only', models: ['Post'], href: () => '/p' }
          ]
        }
      ],
      BUILTIN_ROUTES,
      models
    );
    expect(actionsForModel(reg, 'User').map((a) => a.label)).toEqual(['All', 'User only']);
    expect(actionsForModel(reg, 'Post').map((a) => a.label)).toEqual(['All', 'Post only']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/pluginRegistry.test.ts`

Expected: FAIL — `pluginRegistry.js` does not exist.

- [ ] **Step 3: Implement the registry**

Create `src/lib/server/pluginRegistry.ts`:

```ts
import type { RouteEntry } from './router.js';
import type { AdminPlugin, AdminPluginPage, AdminPluginRecordAction } from './plugin.js';

export interface PluginRegistry {
  routes: RouteEntry[];
  pagesByView: Map<string, AdminPluginPage>;
  recordActions: AdminPluginRecordAction[];
}

export function pluginViewId(pluginName: string, pattern: string[]): string {
  return `plugin/${pluginName}/${pattern.join('/')}`;
}

function patternKey(pattern: string[]): string {
  return pattern.join('\0');
}

function modelVisible(visibleModels: Array<{ name: string }>, entry: string): boolean {
  return visibleModels.some((m) => m.name.toLowerCase() === entry.toLowerCase());
}

function assertKnownModels(
  entries: string[] | undefined,
  visibleModels: Array<{ name: string }>,
  pluginName: string
): void {
  if (!entries) return;
  for (const entry of entries) {
    if (!modelVisible(visibleModels, entry)) {
      throw new Error(
        `[sveltekit-admin] plugin "${pluginName}" models[] includes unknown model "${entry}"`
      );
    }
  }
}

export function resolvePluginRegistry(
  plugins: AdminPlugin[],
  builtinRoutes: RouteEntry[],
  visibleModels: Array<{ name: string }>
): PluginRegistry {
  const builtinKeys = new Map(builtinRoutes.map((r) => [patternKey(r.pattern), r.view]));
  const taken = new Map<string, string>();
  const names = new Set<string>();
  const routes: RouteEntry[] = [];
  const pagesByView = new Map<string, AdminPluginPage>();
  const recordActions: AdminPluginRecordAction[] = [];

  for (const plugin of plugins) {
    if (!plugin.name) {
      throw new Error('[sveltekit-admin] plugin name must be a non-empty string');
    }
    if (names.has(plugin.name)) {
      throw new Error(`[sveltekit-admin] duplicate plugin name "${plugin.name}"`);
    }
    names.add(plugin.name);

    for (const page of plugin.pages ?? []) {
      for (const token of page.pattern) {
        if (token.startsWith(':') && token !== ':model' && token !== ':id') {
          throw new Error(
            `[sveltekit-admin] plugin "${plugin.name}" pattern token "${token}" is not :model or :id`
          );
        }
      }
      const hasModel = page.pattern.includes(':model');
      const hasId = page.pattern.includes(':id');
      if (page.models && !hasModel) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" page ${JSON.stringify(page.pattern)} sets models[] but pattern has no :model`
        );
      }
      if (hasId && !hasModel) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" page ${JSON.stringify(page.pattern)} has :id but pattern has no :model`
        );
      }
      assertKnownModels(page.models, visibleModels, plugin.name);

      const key = patternKey(page.pattern);
      const builtinView = builtinKeys.get(key);
      if (builtinView !== undefined) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" pattern ${JSON.stringify(page.pattern)} overlays builtin route "${builtinView}"`
        );
      }
      const other = taken.get(key);
      if (other !== undefined) {
        throw new Error(
          `[sveltekit-admin] plugin "${plugin.name}" pattern ${JSON.stringify(page.pattern)} collides with plugin "${other}"`
        );
      }
      taken.set(key, plugin.name);
      const view = pluginViewId(plugin.name, page.pattern);
      routes.push({ pattern: page.pattern, view });
      pagesByView.set(view, page);
    }

    for (const action of plugin.recordActions ?? []) {
      assertKnownModels(action.models, visibleModels, plugin.name);
      recordActions.push(action);
    }
  }

  return { routes, pagesByView, recordActions };
}

export function actionsForModel(
  registry: PluginRegistry,
  modelName: string
): AdminPluginRecordAction[] {
  return registry.recordActions.filter(
    (action) =>
      !action.models || action.models.some((n) => n.toLowerCase() === modelName.toLowerCase())
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/pluginRegistry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/pluginRegistry.ts tests/unit/pluginRegistry.test.ts
git commit -m "$(cat <<'EOF'
feat: validate admin plugins at boot and build their route table

EOF
)"
```

---

### Task 3: `listScopeFrom` + scoped plugin data access

**Files:**
- Modify: `src/lib/server/runtime.ts` (add `listScopeFrom`)
- Modify: `src/lib/server/handler.ts` (list GET uses `listScopeFrom`; delete the inline `{}` throw)
- Create: `src/lib/server/pluginAccess.ts`
- Test: `tests/unit/pluginAccess.test.ts`
- Test: existing `tests/unit/fkFilters.test.ts` (must still see the same empty-object message)

**Interfaces:**
- Consumes: `AdminRuntime`, `normalizeScope`, `redactForAudit`, `coerceId`, `primaryKeyOf`, `isSensitiveFieldName`, `escapeHtml`.
- Produces:

```ts
export function listScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any }
): Record<string, unknown> | undefined;

export function createPluginPageContext(
  runtime: AdminRuntime,
  event: any,
  route: { view: string; model?: string; id?: string },
  record?: Record<string, unknown>
): PluginPageContext;
```

Error text for `{}` **verbatim** (do not rewrite):

```
`[sveltekit-admin] models.${model.name}.listWhere returned an empty object ({}), which would silently disable list scoping (fail-open). Return undefined/omit the scope entirely if there is genuinely nothing to scope by for this request, or a condition that actually restricts rows otherwise.`
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pluginAccess.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPluginPageContext } from '../../src/lib/server/pluginAccess.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

afterEach(() => vi.restoreAllMocks());

function ctxFor(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({
    user: [{ id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', tenantId: 1 }],
    post: [{ id: 'p1', title: 'Hello', authorId: 1 }]
  })
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  const runtime = createAdminRuntime({ adapter, ...config } as any);
  const event = { locals: { tenantId: 1 } };
  const ctx = createPluginPageContext(runtime, event, { view: 'plugin/x/:model/:id/graph', model: 'user', id: '1' });
  return { ctx, runtime, prisma };
}

describe('createPluginPageContext — loadRecord', () => {
  it('retourne null si le modèle est invisible', async () => {
    const { ctx } = ctxFor({ exclude: ['Post'] });
    expect(await ctx.loadRecord('Post', 'p1')).toBeNull();
  });

  it('applique listWhere AND pk via findFirst, pas getRecord', async () => {
    const { ctx, prisma } = ctxFor({
      models: { User: { listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId }) } }
    });
    const row = await ctx.loadRecord('User', 1);
    expect(row?.email).toBe('a@b.c');
    expect(prisma.calls.some((c) => c.model === 'user' && c.method === 'findUnique')).toBe(false);
    expect(prisma.calls.some((c) => c.model === 'user' && c.method === 'findFirst')).toBe(true);
  });

  it('retourne null hors listWhere', async () => {
    const { ctx } = ctxFor({
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    });
    expect(await ctx.loadRecord('User', 1)).toBeNull();
  });

  it('throw si listWhere renvoie {}', async () => {
    const { ctx } = ctxFor({ models: { User: { listWhere: () => ({}) } } });
    await expect(ctx.loadRecord('User', 1)).rejects.toThrow(/listWhere returned an empty object/);
  });

  it('redacte hidden + isSensitiveFieldName', async () => {
    const { ctx } = ctxFor({ models: { User: { hidden: ['bio'] } } });
    const row = await ctx.loadRecord('User', 1);
    expect(row).toMatchObject({ id: 1, email: 'a@b.c' });
    expect(row).not.toHaveProperty('password');
    expect(row).not.toHaveProperty('bio');
  });
});

describe('createPluginPageContext — listRecords', () => {
  it('retourne [] si le modèle est invisible', async () => {
    const { ctx } = ctxFor({ exclude: ['Post'] });
    expect(await ctx.listRecords('Post')).toEqual([]);
  });

  it('AND extraFilter + listWhere et redacte chaque row', async () => {
    const prisma = createPrismaMock({
      user: [
        { id: 1, email: 'a@b.c', password: 's3cret', bio: 'x', tenantId: 1, role: 'ADMIN' },
        { id: 2, email: 'b@b.c', password: 's3cret', bio: 'y', tenantId: 1, role: 'USER' },
        { id: 3, email: 'c@b.c', password: 's3cret', bio: 'z', tenantId: 2, role: 'ADMIN' }
      ]
    });
    const { ctx } = ctxFor(
      {
        models: {
          User: {
            hidden: ['bio'],
            listWhere: ({ locals }: any) => ({ tenantId: locals.tenantId })
          }
        }
      },
      prisma
    );
    const rows = await ctx.listRecords('User', { op: 'eq', field: 'role', value: 'ADMIN' });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('a@b.c');
    expect(rows[0]).not.toHaveProperty('password');
    expect(rows[0]).not.toHaveProperty('bio');
  });
});

describe('createPluginPageContext — getM2mSelectedIds', () => {
  it('throw si le modèle est inconnu', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.getM2mSelectedIds('Nope', 'categories', 1)).rejects.toThrow(/unknown model "Nope"/);
  });

  it('throw si le champ n’est pas m2m', async () => {
    const { ctx } = ctxFor();
    await expect(ctx.getM2mSelectedIds('User', 'posts', 1)).rejects.toThrow(/is not an m2m relation/);
  });

  it('délègue à adapter.data.getM2mSelectedIds', async () => {
    const { ctx, runtime } = ctxFor();
    const spy = vi.spyOn(runtime.adapter.data, 'getM2mSelectedIds').mockResolvedValue(['c1']);
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).resolves.toEqual(['c1']);
    expect(spy).toHaveBeenCalled();
  });
});

describe('createPluginPageContext — surface', () => {
  it('expose escapeHtml, isSensitiveFieldName (prédicat partagé) et pas d’adapter', () => {
    const { ctx } = ctxFor();
    expect(ctx.escapeHtml('<x>')).toBe('&lt;x&gt;');
    expect(ctx.isSensitiveFieldName('passwordHash')).toBe(true);
    expect(ctx.findModel('user')?.name).toBe('User');
    expect(ctx.relationGraph).not.toBeNull();
    expect(ctx).not.toHaveProperty('adapter');
    expect(Object.keys(ctx)).not.toContain('config');
  });
});
```

Note: FULL_SCHEMA `User` has no `tenantId` field. `listWhere: { tenantId: 1 }` is still a valid Filter leaf for the mock (`matchesWhere` compares `record.tenantId`). That matches how `fkFilters.test.ts` scopes Post. Do not add a schema field.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/pluginAccess.test.ts`

Expected: FAIL — `pluginAccess.js` does not exist.

- [ ] **Step 3: Extract `listScopeFrom` and implement access**

In `src/lib/server/runtime.ts`, add (next to `scopeFrom`) and import `Model` is already there:

```ts
export function listScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any }
): Record<string, unknown> | undefined {
  const listScope = runtime.config.models?.[model.name]?.listWhere?.(ctx);
  // A scope function returning `{}` (falsy-looking but truthy as
  // an object) would otherwise silently fail OPEN — `{}` composed
  // into an AND matches every row, exactly the opposite of what a
  // caller configuring listWhere expects (real gap found in
  // review: `locals.userId` undefined after a session expires is
  // a realistic way to hit this). Fail loud instead: a scope
  // function is either omitted entirely, or must return at least
  // one condition every time it runs.
  if (listScope && Object.keys(listScope).length === 0) {
    throw new Error(
      `[sveltekit-admin] models.${model.name}.listWhere returned an empty object ({}), ` +
        `which would silently disable list scoping (fail-open). Return undefined/omit the ` +
        `scope entirely if there is genuinely nothing to scope by for this request, or a ` +
        `condition that actually restricts rows otherwise.`
    );
  }
  return listScope;
}
```

In `handler.ts` list GET, replace the `listWhere` call + `{}` throw block with:

```ts
          const listScope = listScopeFrom(runtime, model, { locals: event.locals });
```

Import `listScopeFrom` from `./runtime.js` (keep existing `createAdminRuntime` import; add `listScopeFrom` to it).

Create `src/lib/server/pluginAccess.ts`:

```ts
import { normalizeScope } from './adapters/filter.js';
import type { Filter } from './adapters/types.js';
import { redactForAudit } from './audit.js';
import { coerceId, primaryKeyOf } from './data.js';
import { isSensitiveFieldName } from './introspection/parser.js';
import type { PluginPageContext } from './plugin.js';
import { listScopeFrom, type AdminRuntime } from './runtime.js';
import type { Model } from './types/schema.js';
import { escapeHtml } from './views/html.js';

function andFilters(...parts: Array<Filter | Record<string, unknown> | undefined>): Filter | undefined {
  const clauses = parts.filter((p): p is Filter | Record<string, unknown> => p !== undefined);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0] as Filter;
  return { op: 'and', clauses: clauses as Filter[] };
}

function redactRow(runtime: AdminRuntime, model: Model, row: Record<string, unknown>): Record<string, unknown> {
  return redactForAudit(row, model, runtime.hiddenFieldsOf(model));
}

export function createPluginPageContext(
  runtime: AdminRuntime,
  event: any,
  route: { view: string; model?: string; id?: string },
  record?: Record<string, unknown>
): PluginPageContext {
  const loadRecord = async (
    modelName: string,
    id: string | number
  ): Promise<Record<string, unknown> | null> => {
    const model = runtime.findModel(modelName);
    if (!model) return null;
    const rawScope = listScopeFrom(runtime, model, { locals: event.locals });
    const scope = normalizeScope(rawScope);
    const idFilter = {
      op: 'eq' as const,
      field: primaryKeyOf(model),
      value: coerceId(String(id), model)
    };
    const filter = (scope ? { op: 'and' as const, clauses: [idFilter, scope] } : idFilter) as Filter;
    const row = await runtime.adapter.data.findFirst(model, filter);
    return row ? redactRow(runtime, model, row) : null;
  };

  const listRecords = async (
    modelName: string,
    extraFilter?: Filter
  ): Promise<Record<string, unknown>[]> => {
    const model = runtime.findModel(modelName);
    if (!model) return [];
    const rawScope = listScopeFrom(runtime, model, { locals: event.locals });
    const scope = normalizeScope(rawScope);
    const filter = andFilters(scope, extraFilter);
    const rows = await runtime.adapter.data.findMany(model, { filter: filter as Filter | undefined });
    return rows.map((row) => redactRow(runtime, model, row));
  };

  const getM2mSelectedIds = async (
    modelName: string,
    fieldName: string,
    recordId: string | number
  ): Promise<Array<string | number>> => {
    const model = runtime.findModel(modelName);
    if (!model || !runtime.relationGraph) {
      throw new Error(`[sveltekit-admin] getM2mSelectedIds: unknown model "${modelName}"`);
    }
    const edge = runtime.relationGraph.edges.get(`${model.name}.${fieldName}`);
    if (!edge || edge.kind !== 'm2m') {
      throw new Error(
        `[sveltekit-admin] getM2mSelectedIds: "${model.name}.${fieldName}" is not an m2m relation`
      );
    }
    const target = runtime.findModel(edge.target);
    if (!target) {
      throw new Error(
        `[sveltekit-admin] getM2mSelectedIds: target model "${edge.target}" is not visible`
      );
    }
    return runtime.adapter.data.getM2mSelectedIds(model, edge, target, recordId);
  };

  return {
    event,
    route,
    basePath: runtime.basePath,
    record,
    escapeHtml,
    findModel: runtime.findModel,
    relationGraph: runtime.relationGraph,
    resolveLabel: runtime.resolveLabel,
    hiddenFieldsOf: runtime.hiddenFieldsOf,
    isSensitiveFieldName,
    loadRecord,
    listRecords,
    getM2mSelectedIds
  };
}
```

`getM2mSelectedIds` target-not-visible throw needs a test for 100% coverage. Add to `pluginAccess.test.ts`:

```ts
  it('throw si la cible m2m n’est pas visible', async () => {
    const { ctx } = ctxFor({ exclude: ['Category'] });
    await expect(ctx.getM2mSelectedIds('Post', 'categories', 'p1')).rejects.toThrow(
      /target model "Category" is not visible/
    );
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run tests/unit/pluginAccess.test.ts tests/unit/fkFilters.test.ts tests/unit/runtime.test.ts tests/unit/handler.test.ts
```

Expected: PASS. Empty-object listWhere on the **list** view still renders the same error string (`fkFilters.test.ts`).

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/runtime.ts src/lib/server/handler.ts src/lib/server/pluginAccess.ts tests/unit/pluginAccess.test.ts
git commit -m "$(cat <<'EOF'
feat: add scoped plugin record helpers and share listWhere fail-loud

EOF
)"
```

---

### Task 4: Handler dispatch (pages, slots, fake plugin)

**Files:**
- Create: `tests/fixtures/fakeGraphPlugin.ts`
- Create: `tests/unit/handler.plugins.test.ts`
- Modify: `src/lib/server/handler.ts`

**Interfaces:**
- Consumes: `resolvePluginRegistry`, `actionsForModel`, `pluginViewId` (Task 2); `createPluginPageContext` / `listScopeFrom` (Task 3); `matchRoute` / `BUILTIN_ROUTES`.
- Produces: handler that concatenates plugin routes, 405 on non-GET plugin views, GET plugin pages in Layout, list/edit `recordActions` from the registry. `plugins` omitted ≡ today.

- [ ] **Step 1: Write the failing tests + fake plugin**

Create `tests/fixtures/fakeGraphPlugin.ts`:

```ts
import type { AdminPlugin } from '../../src/lib/server/plugin.js';

export function fakeGraphPlugin(opts: { models?: string[] } = {}): AdminPlugin {
  const models = opts.models ?? ['User'];
  return {
    name: 'fake-graph',
    pages: [
      {
        pattern: [':model', ':id', 'graph'],
        models,
        render: (ctx) => ({
          html: `<div class="ska-fake-graph">${ctx.escapeHtml(JSON.stringify(ctx.record ?? null))}</div>`,
          styles: '.ska-fake-graph{color:red}',
          scripts: 'window.__skaFakeGraph=1'
        })
      }
    ],
    recordActions: [
      {
        label: 'Graph',
        models,
        href: ({ model, id, basePath }) => `${basePath}/${model.toLowerCase()}/${id}/graph`
      }
    ]
  };
}
```

Create `tests/unit/handler.plugins.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler as createCoreHandler } from '../../src/lib/server/handler.js';
import { createAdminHandler as createPrismaHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';
import { fakeGraphPlugin } from '../fixtures/fakeGraphPlugin.js';
import type { AdminPlugin } from '../../src/lib/server/plugin.js';

afterEach(() => vi.restoreAllMocks());

const USER = { id: 1, email: 'a@b.c', password: 's3cret', bio: 'hidden-bio', name: 'Ada' };
const POST = { id: 'p1', title: 'Hello', authorId: 1, content: 'x' };

function core(config: Record<string, unknown> = {}, prisma = createPrismaMock({ user: [USER], post: [POST] })) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return {
    handler: createCoreHandler({ adapter, plugins: [fakeGraphPlugin()], ...config } as any),
    prisma
  };
}

async function html(handler: any, url: string, extra?: Parameters<typeof createEvent>[0]) {
  const { event, resolve } = createEvent({ url, ...extra });
  const res = await handler({ event, resolve } as any);
  return { res, text: await res.text() };
}

describe('plugins omis', () => {
  it('GET /admin/user/1/graph → NotFound ; pas de script extra ni ska-record-actions', async () => {
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter });
    const graph = await html(handler, '/admin/user/1/graph');
    expect(graph.text).toContain('Page not found');
    expect(graph.text).not.toContain('ska-fake-graph');
    const list = await html(handler, '/admin/user');
    expect(list.text).not.toContain('ska-record-actions');
    expect(list.text).not.toContain('/admin/user/1/graph');
    expect(list.text).not.toContain('window.__skaFakeGraph');
  });
});

describe('page plugin fake-graph', () => {
  it('GET /admin/user/1/graph rend HTML + CSS/JS dans le Layout', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
    expect(text).toContain('a@b.c');
    expect(text).toContain('.ska-fake-graph{color:red}');
    expect(text).toContain('<script>window.__skaFakeGraph=1</script>');
    expect(text).toContain('href="/admin/user"');
  });

  it('n’injecte pas le JS/CSS plugin sur list/edit/dashboard', async () => {
    const { handler } = core();
    for (const url of ['/admin', '/admin/user', '/admin/user/1']) {
      const { text } = await html(handler, url);
      expect(text).not.toContain('window.__skaFakeGraph');
      expect(text).not.toContain('.ska-fake-graph{color:red}');
    }
  });

  it('GET /admin/post/1/graph → 404 et render non appelé', async () => {
    const render = vi.fn(async () => ({ html: 'SHOULD_NOT' }));
    const plugin: AdminPlugin = {
      name: 'fake-graph',
      pages: [{ pattern: [':model', ':id', 'graph'], models: ['User'], render }]
    };
    const prisma = createPrismaMock({ user: [USER], post: [POST] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/post/p1/graph');
    expect(text).toContain('not found');
    expect(text).not.toContain('SHOULD_NOT');
    expect(render).not.toHaveBeenCalled();
  });

  it('listWhere hors scope → 404, render non appelé', async () => {
    const render = vi.fn(async () => ({ html: 'SHOULD_NOT' }));
    const plugin: AdminPlugin = {
      name: 'fake-graph',
      pages: [{ pattern: [':model', ':id', 'graph'], models: ['User'], render }]
    };
    const prisma = createPrismaMock({ user: [{ ...USER, tenantId: 1 }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({
      adapter,
      plugins: [plugin],
      models: { User: { listWhere: () => ({ tenantId: 99 }) } }
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toMatch(/User with ID "1" not found/);
    expect(render).not.toHaveBeenCalled();
  });

  it('hidden + password absents du HTML même si le plugin dump record', async () => {
    const { handler } = core({ models: { User: { hidden: ['bio'] } } });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('hidden-bio');
    expect(text).toContain('a@b.c');
  });

  it('POST /admin/user/1/graph → 405, pas de delete', async () => {
    const { handler, prisma } = core();
    const { event, resolve } = createEvent({
      url: '/admin/user/1/graph',
      body: { _action: 'delete' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('authCheck false → 401 sur la page plugin', async () => {
    const { handler } = core({ authCheck: () => false });
    const { res, text } = await html(handler, '/admin/user/1/graph');
    expect(res.status).toBe(401);
    expect(text).toBe('Unauthorized');
  });

  it('page [hello] sans :id', async () => {
    const plugin: AdminPlugin = {
      name: 'hello',
      pages: [
        {
          pattern: ['hello'],
          render: (ctx) => ({ html: `hello-ok:${ctx.record === undefined ? 'no-record' : 'record'}` })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/hello');
    expect(text).toContain('hello-ok:no-record');
  });

  it('overlap : premier plugin gagne', async () => {
    const first: AdminPlugin = {
      name: 'first',
      pages: [
        {
          pattern: ['user', ':id', 'graph'],
          render: async () => ({ html: 'FROM_FIRST' })
        }
      ]
    };
    const second: AdminPlugin = {
      name: 'second',
      pages: [
        {
          pattern: [':model', ':id', 'graph'],
          render: async () => ({ html: 'FROM_SECOND' })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [first, second] });
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('FROM_FIRST');
    expect(text).not.toContain('FROM_SECOND');
  });
});

describe('recordActions', () => {
  it('liste User : Graph avant Edit', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user');
    expect(text).toContain('href="/admin/user/1/graph"');
    const graphAt = text.indexOf('href="/admin/user/1/graph"');
    const editAt = text.indexOf('>Edit</a>');
    expect(graphAt).toBeGreaterThan(-1);
    expect(graphAt).toBeLessThan(editAt);
  });

  it('edit User : barre hors form POST', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1');
    expect(text).toContain('ska-record-actions');
    expect(text).toContain('href="/admin/user/1/graph"');
    const actionHref = text.indexOf('href="/admin/user/1/graph"');
    const formStart = text.indexOf('<form method="POST"');
    expect(actionHref).toBeLessThan(formStart);
  });

  it('create User : pas d’action plugin', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/new');
    expect(text).not.toContain('ska-record-actions');
    expect(text).not.toContain('/graph');
  });

  it('liste/edit Post : pas de lien Graph', async () => {
    const { handler } = core();
    const list = await html(handler, '/admin/post');
    expect(list.text).not.toContain('/graph');
    const edit = await html(handler, '/admin/post/p1');
    expect(edit.text).not.toContain('/graph');
  });

  it('échappe label et href XSS', async () => {
    const plugin: AdminPlugin = {
      name: 'xss',
      recordActions: [
        {
          label: '<img>',
          href: () => '/admin/user/1/graph" onclick="alert(1)'
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const list = await html(handler, '/admin/user');
    expect(list.text).toContain('&lt;img&gt;');
    expect(list.text).not.toMatch(/<td class="ska-table__actions">[^<]*<img>/);
    expect(list.text).toContain('onclick=&quot;alert(1)');
    const edit = await html(handler, '/admin/user/1');
    expect(edit.text).toContain('&lt;img&gt;');
    expect(edit.text).not.toContain('<img>');
  });
});

describe('wrapper prisma + adapter', () => {
  it('createAdminHandler({ prisma, plugins }) sert la page', async () => {
    const prisma = createPrismaMock({ user: [USER] });
    const handler = createPrismaHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      plugins: [fakeGraphPlugin()]
    } as any);
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
  });

  it('createAdminHandler({ adapter, plugins }) sert la page', async () => {
    const { handler } = core();
    const { text } = await html(handler, '/admin/user/1/graph');
    expect(text).toContain('ska-fake-graph');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/handler.plugins.test.ts`

Expected: FAIL — handler still `parseRoute`s builtins only, `/graph` is NotFound even with `plugins`.

- [ ] **Step 3: Wire the handler**

In `src/lib/server/handler.ts`:

1. Imports — replace `parseRoute` with `matchRoute, BUILTIN_ROUTES`; add:

```ts
import { resolvePluginRegistry, actionsForModel } from './pluginRegistry.js';
import { createPluginPageContext } from './pluginAccess.js';
```

(`listScopeFrom` already imported from Task 3.)

2. After `const runtime = createAdminRuntime(config);`:

```ts
  const registry = resolvePluginRegistry(config.plugins ?? [], BUILTIN_ROUTES, runtime.models);
```

3. Replace `const route = parseRoute(pathname, runtime.basePath);` with:

```ts
    const route = matchRoute(pathname, runtime.basePath, [
      ...BUILTIN_ROUTES,
      ...registry.routes
    ]);
```

Logout / authCheck / search stay on `route.view === 'logout' | 'search'` (builtin view strings unchanged).

4. After the search branch, before POST mutation, add the plugin branch. Keep it **outside** the mutation call so POST `/…/graph` cannot delete:

```ts
    const pluginPage = registry.pagesByView.get(route.view);
    if (pluginPage) {
      if (event.request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      }
    }
```

5. Inside the existing GET `try`, **before** `if (route.view === 'notFound')`, handle plugin pages. Declare `let extraStyles = ''; let extraScripts = '';` next to `let content` / `let currentModel`. Pass them into Layout instead of `''`.

Plugin GET body (inside the try):

```ts
      if (pluginPage) {
        const hasModel = pluginPage.pattern.includes(':model');
        const hasId = pluginPage.pattern.includes(':id');
        if (hasModel) {
          currentModel = route.model;
          const model = runtime.findModel(route.model);
          const allowed =
            model &&
            (!pluginPage.models ||
              pluginPage.models.some((n) => n.toLowerCase() === model.name.toLowerCase()));
          if (!model || !allowed) {
            content = render(NotFound, {
              props: { message: 'Page not found', basePath: runtime.basePath }
            }).body;
          } else if (hasId) {
            const ctx = createPluginPageContext(runtime, event, route);
            const loaded = await ctx.loadRecord(model.name, route.id!);
            if (!loaded) {
              content = render(NotFound, {
                props: {
                  message: `${model.name} with ID "${route.id}" not found`,
                  basePath: runtime.basePath
                }
              }).body;
            } else {
              const result = await pluginPage.render(
                createPluginPageContext(runtime, event, route, loaded)
              );
              content = result.html;
              extraStyles = result.styles ?? '';
              extraScripts = result.scripts ?? '';
            }
          } else {
            const result = await pluginPage.render(createPluginPageContext(runtime, event, route));
            content = result.html;
            extraStyles = result.styles ?? '';
            extraScripts = result.scripts ?? '';
          }
        } else {
          const result = await pluginPage.render(createPluginPageContext(runtime, event, route));
          content = result.html;
          extraStyles = result.styles ?? '';
          extraScripts = result.scripts ?? '';
        }
      } else if (route.view === 'notFound') {
```

Then the existing `notFound` / `dashboard` / `route.model` chain becomes the `else if` of that plugin `if`. Do not leave a second `if (route.view === 'notFound')` that also runs.

The `hasModel && !hasId` branch (`[':model', 'stats']`) is required for coverage if that pattern is legal. Task 2 allows it. Add a test in this file:

```ts
  it('page :model sans :id', async () => {
    const plugin: AdminPlugin = {
      name: 'stats',
      pages: [
        {
          pattern: [':model', 'stats'],
          render: (ctx) => ({ html: `stats:${ctx.route.model}:${ctx.record === undefined ? 'no' : 'yes'}` })
        }
      ]
    };
    const prisma = createPrismaMock({ user: [USER] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const handler = createCoreHandler({ adapter, plugins: [plugin] });
    const { text } = await html(handler, '/admin/user/stats');
    expect(text).toContain('stats:user:no');
  });
```

If you skip that test, the `hasModel && !hasId` branch is uncovered — **do not** write an unreachable branch. Either ship the test or structure the code so the only `:id`-less plugin pages are those without `:model` (hello). Preferred: keep the branch + the test above (pattern is valid per spec).

6. List render: replace `recordActions: []` with:

```ts
              recordActions: actionsForModel(registry, model.name).map((action) => ({
                label: action.label,
                hrefFor: (id: string | number) =>
                  action.href({ model: model.name, id, basePath: runtime.basePath })
              }))
```

7. Edit Form (the `item ? render(Form, { mode: 'edit' ...})` only — not create):

```ts
                  recordActions: actionsForModel(registry, model.name).map((action) => ({
                    label: action.label,
                    href: action.href({
                      model: model.name,
                      id: item[runtime.viewModel(model).primaryKey] as string | number,
                      basePath: runtime.basePath
                    })
                  }))
```

Create Form stays `recordActions: []`.

8. Layout props:

```ts
        extraStyles,
        extraScripts
```

`extraStyles` / `extraScripts` stay `''` on builtin pages (initialized before the try, only assigned in the plugin success path). Plugin NotFound must **not** assign plugin assets.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run tests/unit/handler.plugins.test.ts tests/unit/handler.test.ts tests/unit/handler.core.test.ts tests/unit/router.test.ts tests/characterization tests/unit/pluginRegistry.test.ts tests/unit/pluginAccess.test.ts tests/unit/views/layout.test.ts
```

Expected: PASS. Characterization HTML without plugins unchanged (no extra `<script>`, no `ska-record-actions`, `/graph` still notFound when `plugins` omitted).

If a characterization snapshot differs on empty `{#if extraScripts}` comments: you changed Layout — revert Layout. Only the handler should pass non-empty strings on plugin pages.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/handler.ts tests/fixtures/fakeGraphPlugin.ts tests/unit/handler.plugins.test.ts
git commit -m "$(cat <<'EOF'
feat: dispatch plugin pages and record actions from createAdminHandler

EOF
)"
```

---

### Task 5: Docs, changeset, CLAUDE.md, full suite

**Files:**
- Create: `docs/src/lib/content/docs/plugins.svx`
- Modify: `docs/src/lib/config/navigation.ts`
- Modify: `docs/src/lib/content/docs/configuration-reference.svx`
- Modify: `docs/src/lib/content/docs/how-it-works.svx`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Create: `.changeset/admin-plugin-api.md`

**Interfaces:**
- Consumes: public API from Tasks 1–4.
- Produces: consumer docs + minor changelog entry. No graph factory.

- [ ] **Step 1: Docs site**

Add to `docs/src/lib/config/navigation.ts` in the `configuration` items, after audit-log:

```ts
					{ slug: 'audit-log', name: 'Audit log' },
					{ slug: 'plugins', name: 'Plugins' }
```

Create `docs/src/lib/content/docs/plugins.svx`:

```svx
---
title: Plugins
name: Plugins
description: Register extra admin pages and record actions via plugins[].
---

`createAdminHandler` accepts an optional `plugins` array. Each plugin can
add **new pages** (SSR HTML inside the existing admin layout, plus inline
CSS/JS) and **links** on the edit screen and each list row. Plugins cannot
replace the dashboard, list, or form, intercept create/update/delete, or
add a sidebar entry.

```ts
import { createAdminHandler } from 'sveltekit-admin';
import type { AdminPlugin } from 'sveltekit-admin';

const auditTrail: AdminPlugin = {
  name: 'audit-trail',
  pages: [
    {
      pattern: [':model', ':id', 'trail'],
      models: ['User'],
      render: async (ctx) => ({
        html: `<h1>Trail for ${ctx.escapeHtml(String(ctx.record?.email ?? ctx.route.id))}</h1>`,
        styles: '',
        scripts: ''
      })
    }
  ],
  recordActions: [
    {
      label: 'Trail',
      models: ['User'],
      href: ({ model, id, basePath }) => `${basePath}/${model.toLowerCase()}/${id}/trail`
    }
  ]
};

export const handle = createAdminHandler({
  prisma,
  plugins: [auditTrail]
});
```

Factory options such as `relationGraphPlugin({ models, depth })` belong on
**the plugin author**, not on `createAdminHandler`. The core only sees
`AdminPlugin`.

## `AdminPlugin`

- `name` — unique, non-empty. Used in boot errors and internal view ids.
- `pages` — `pattern` tokens are literals, `:model`, or `:id` only. Typical
  graph URL: `[':model', ':id', 'graph']`.
- `recordActions` — `{ label, href({ model, id, basePath }), models? }`.
  Shown on **edit** and **list rows** (before Edit), never on create.
- `models?: string[]` on a page or action — omit means every visible model.
  A page whose pattern matches but whose model is not listed returns 404.

Colliding with a builtin pattern (`:model`, `:model/:id`, `_search`, …) or
with another plugin's exact pattern **throws at boot**. Actions concatenate
in `plugins` array order.

## Security

Plugin pages run **after** `authCheck`. Logout POST is unchanged.

Reads must go through `ctx.loadRecord` / `ctx.listRecords` /
`ctx.getM2mSelectedIds`. There is no ORM client on the context.

- `loadRecord` / `listRecords` apply that model's `listWhere` (AND, never a
  spread) and strip `hidden` plus sensitive names (`password` / `hash` /
  `secret` / `token`) via the same redaction as the audit log.
- A `:id` outside `listWhere` is a 404 — `render` is not called. This is
  **stricter than edit**: `/admin/user/1` still uses unscoped `getRecord`.
  `listWhere` is not a tenant wall for the whole admin.
- A `listWhere` that returns `{}` still throws (fail-loud).
- Action labels and hrefs are HTML-escaped. Plugin `html` / `styles` /
  `scripts` are developer-supplied (same trust as `branding.primaryColor`);
  interpolate database fields with `ctx.escapeHtml`.

POST (and any non-GET) to a plugin page is `405`. Writes stay on the
builtin list/create/edit POST handlers, or on your own app routes linked
from a `recordAction`.
```

In `docs/src/lib/content/docs/configuration-reference.svx`:

- In the full example, after `branding`, add:

```ts
  // Extra pages + record actions (optional)
  plugins: []
```

- In the options table, after `branding`, add a row:

```
| `plugins` | `AdminPlugin[]` | `[]` | Extra pages and per-record links. See [Plugins](/docs/plugins). |
```

In `docs/src/lib/content/docs/how-it-works.svx`, after the routes table, add:

```
Plugins may register additional path patterns (for example
`/admin/user/1/graph`). Those pages still render inside the same layout;
see [Plugins](/docs/plugins).
```

- [ ] **Step 2: README + CLAUDE.md + changeset**

`README.md` Features — after the audit-log bullet:

```
- 🧩 **Plugins** - optional extra pages and record actions (`plugins: []`)
```

After the Audit log section (before Model Configuration), add:

```md
## Plugins

Pass `plugins` to register extra admin pages (SSR HTML + inline CSS/JS)
and links on edit screens and list rows. See the exported `AdminPlugin`
type and the documentation site's Plugins page.

```ts
createAdminHandler({
  prisma,
  plugins: [
    {
      name: 'hello',
      pages: [{ pattern: ['hello'], render: () => ({ html: '<p>Hello</p>' }) }]
    }
  ]
});
```

Omit `plugins` and the admin is unchanged.
```


In `CLAUDE.md` Request flow:

- Step 2 Routing: `parseRoute` is no longer what the handler uses. Replace with: the handler calls `matchRoute(pathname, basePath, [...BUILTIN_ROUTES, ...pluginRoutes])`. `parseRoute` remains builtins-only for tests. Plugin patterns such as `[':model', ':id', 'graph']` match when registered; without `plugins` they stay `notFound`.
- After authCheck / search: plugin views, non-GET → 405; GET → scoped preload + `render` in Layout.
- GET builtin: Form/List `recordActions` come from the plugin registry (empty if no plugins). Layout `extraStyles` / `extraScripts` are filled only on plugin pages.

In "Where behavior actually lives", add:

```
- **`plugin.ts` / `pluginRegistry.ts` / `pluginAccess.ts`**: public `AdminPlugin` contract, boot validation (no builtin overlay, no duplicate patterns), scoped reads for plugin pages. Not a public runtime export.
```

In Security invariants, add (do not weaken existing bullets):

```
- Plugin page context has no `adapter`. Record payloads from `loadRecord` / `listRecords` / the preloaded `record` are redacted with `redactForAudit` (`hidden` + `isSensitiveFieldName`). Out-of-`listWhere` `:id` is 404 before `render`. This does not scope builtin edit/delete.
- Non-GET requests to a plugin view are 405; `handleMutation` stays on builtin list/create/edit only.
```

Create `.changeset/admin-plugin-api.md`:

```md
---
"sveltekit-admin": minor
---

Add a **`plugins`** option on `createAdminHandler` and export the `AdminPlugin` types (new pages inside the existing layout, record-row / edit-screen links, inline CSS/JS). Plugin reads go through scoped helpers (`listWhere` plus `hidden` / sensitive-field redaction), not the ORM client. Omitting `plugins` leaves `createAdminHandler({ prisma })` unchanged.
```

- [ ] **Step 3: Full verification**

```bash
pnpm run test
pnpm run check
```

Expected: all tests pass (characterization + Prisma/Drizzle integration + new plugin tests); `svelte-check` clean; coverage 100% on `src/lib/**`. If `pnpm run lint` is cheap, run it too. Do not `prettier --write` the whole repo; only format files you touched if lint complains.

If coverage misses a handler branch, add a test in `handler.plugins.test.ts` rather than a `v8 ignore`.

- [ ] **Step 4: Commit** (skip unless the user asked)

```bash
git add docs/src/lib/content/docs/plugins.svx docs/src/lib/config/navigation.ts docs/src/lib/content/docs/configuration-reference.svx docs/src/lib/content/docs/how-it-works.svx README.md CLAUDE.md .changeset/admin-plugin-api.md
git commit -m "$(cat <<'EOF'
docs: document AdminPlugin registration and add minor changeset

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| `AdminPlugin` + ctx types, no `createAdminRuntime` export | 1 |
| `plugins?` on core + Prisma wrapper + drizzle re-export | 1 |
| Registry boot: name, overlay, collision, `:foo`, unknown `models[]`, `models[]` without `:model`, `:id` without `:model` | 2 |
| Actions concat + `actionsForModel` | 2 |
| `listScopeFrom` shared with list GET, same `{}` message | 3 |
| `loadRecord` / `listRecords` AND `listWhere`, `findFirst` not `getRecord`, `redactForAudit` | 3 |
| No `adapter` / writes on ctx; m2m ids unscoped | 3 |
| `matchRoute` concat; `parseRoute` builtins-only | 4 |
| Plugin GET in Layout; assets only on that request; Svelte extraStyles fusion untouched | 4 |
| Non-GET plugin → 405; no mutation via `/graph` | 4 |
| `:id` preload 404 before `render`; whitelist 404 | 4 |
| List/edit actions; create `[]`; XSS escaped | 4 |
| `{ prisma }` and `{ adapter }` accept `plugins` | 4 |
| `plugins` omitted = characterization zero | 4 |
| Fake plugin in tests only | 4 |
| Overlap first-match; hello page without `:id` | 4 |
| Docs + README + CLAUDE.md + minor changeset | 5 |
| No graph plugin, no JSON, no nav, no CRUD intercept | none by design |
