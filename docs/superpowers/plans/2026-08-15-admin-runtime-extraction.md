# Admin Runtime Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an internal `AdminRuntime`, a pattern-based route table, and empty UI slots (Layout scripts/styles, Form/List record actions) from `createAdminHandler` with zero observable behavior change.

**Architecture:** Boot moves into `createAdminRuntime(config)`. `parseRoute` becomes `matchRoute(..., BUILTIN_ROUTES)`. Relation loaders, `_search`, and POST mutations become modules that take `runtime` as an argument. Layout / Form / List gain optional slots that default to empty; the handler always passes `''` / `[]`. No `plugins` field, no new public exports.

**Tech Stack:** TypeScript, Svelte 5 (`$props`), `render()` from `svelte/server`, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-admin-runtime-extraction-design.md`

## Global Constraints

- **100% coverage, no exceptions**: `vitest.config.ts` enforces lines/statements/functions/branches at 100% on `src/lib/**`. No `exclude`, no `v8 ignore`.
- **Zero public API change**: no new exports on `src/lib/index.ts`; `tests/unit/index.test.ts` `RUNTIME_EXPORTS` / `TYPE_ONLY_EXPORTS` stay exactly as they are; no `plugins` on `AdminHandlerConfig`.
- **`createAdminHandler` stays synchronous.** No `import()`.
- **Do not implement the plugin API, graph plugin, JSON plugin routes, or nav slots.** Appendix of the spec is north-star only.
- Package manager is **pnpm**. Single-file: `pnpm exec vitest run <path>`. Full suite: `pnpm run test`. Types: `pnpm run check`. Run `pnpm run test:gen` once in a fresh shell before tests if `tests/fixtures/prisma/client/` is missing.
- Quote style: single quotes, match `handler.ts`.
- Do not commit unless the user explicitly asked — skip every Commit step if they have not.
- Do not refactor `formDataToPrisma`, public `Prisma*` aliases, or add `./core` / `./runtime` package exports.

## File map

| File | Role |
| --- | --- |
| `src/lib/server/router.ts` | `RouteEntry`, `BUILTIN_ROUTES`, `matchRoute`, `parseRoute` (wrapper). |
| `src/lib/server/views/types.ts` | Add `RecordAction`, `ListRecordAction`. |
| `src/lib/server/views/Layout.svelte` | Optional `extraStyles` / `extraScripts`. |
| `src/lib/server/views/Form.svelte` | Optional `recordActions` (edit only). |
| `src/lib/server/views/List.svelte` | Optional `recordActions` in the existing Actions cell. |
| `src/lib/server/runtime.ts` | `AdminRuntime`, `createAdminRuntime`, `scopeFrom`. |
| `src/lib/server/relationLoaders.ts` | `loadRelationOptions`, `resolveFkFilterOptions`, `loadRelatedCounts`. |
| `src/lib/server/search.ts` | `handleSearch`. |
| `src/lib/server/mutations.ts` | `handleMutation` (POST create/update/delete). |
| `src/lib/server/handler.ts` | Throw if no adapter, boot via runtime, dispatch, GET render, wrap Layout with empty slots. |
| `tests/unit/router.test.ts` | Existing `parseRoute` cases + `matchRoute` extra pattern. |
| `tests/unit/views/layout.test.ts` | Slot empty / non-empty. |
| `tests/unit/views/form.test.ts` | Edit actions + escape; create ignores. |
| `tests/unit/views/list.test.ts` | Row actions + `hrefFor` + colspan unchanged. |
| `tests/unit/runtime.test.ts` | Boot helpers. |
| `CLAUDE.md` | Request-flow paragraph. |
| `.changeset/admin-runtime-extraction.md` | Patch. |

---

### Task 1: Pattern-based router

**Files:**
- Modify: `src/lib/server/router.ts`
- Test: `tests/unit/router.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:

```ts
export interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit' | 'notFound' | 'search' | 'logout';
  model?: string;
  id?: string;
}

export interface RouteEntry {
  pattern: string[];
  view: string;
}

export const BUILTIN_ROUTES: RouteEntry[];

export function matchRoute(
  pathname: string,
  basePath: string,
  routes: RouteEntry[]
): { view: string; model?: string; id?: string };

export function parseRoute(pathname: string, basePath: string): ParsedRoute;
```

- [ ] **Step 1: Write the failing tests**

Keep every existing `parseRoute` assertion in `tests/unit/router.test.ts` (including 3-segment `notFound` and `/admin/_logout/1` → edit). Append:

```ts
import { parseRoute, matchRoute, BUILTIN_ROUTES } from '../../src/lib/server/router.js';

describe('matchRoute extra pattern (plugin seam, not on parseRoute)', () => {
  const routes = [
    ...BUILTIN_ROUTES,
    { pattern: [':model', ':id', 'graph'], view: 'graph' }
  ];

  it('matches /admin/user/1/graph when the extra entry is registered', () => {
    expect(matchRoute('/admin/user/1/graph', '/admin', routes)).toEqual({
      view: 'graph',
      model: 'user',
      id: '1'
    });
  });

  it('parseRoute on the same path stays notFound (builtin table only)', () => {
    expect(parseRoute('/admin/user/1/graph', '/admin')).toEqual({ view: 'notFound' });
  });

  it('still prefers create over edit for /user/new', () => {
    expect(matchRoute('/admin/user/new', '/admin', routes)).toEqual({
      view: 'create',
      model: 'user'
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/router.test.ts`

Expected: FAIL — `matchRoute` / `BUILTIN_ROUTES` are not exported.

- [ ] **Step 3: Implement the matcher**

Replace `src/lib/server/router.ts` with:

```ts
export interface ParsedRoute {
  view: 'dashboard' | 'list' | 'create' | 'edit' | 'notFound' | 'search' | 'logout';
  model?: string;
  id?: string;
}

export interface RouteEntry {
  pattern: string[];
  view: string;
}

export const BUILTIN_ROUTES: RouteEntry[] = [
  { pattern: [], view: 'dashboard' },
  { pattern: ['_search'], view: 'search' },
  { pattern: ['_logout'], view: 'logout' },
  { pattern: [':model', 'new'], view: 'create' },
  { pattern: [':model', ':id'], view: 'edit' },
  { pattern: [':model'], view: 'list' }
];

function relativeSegments(pathname: string, basePath: string): string[] {
  // Le `replace` n'est PAS redondant avec le `filter(Boolean)` plus bas : il est ce
  // qui fait que `/admin/` et `/admin///` donnent un `path` vide, donc le dashboard.
  // Sans lui, `path` vaudrait '/' — truthy — et le chemin tomberait sur `notFound`.
  const path = pathname.slice(basePath.length).replace(/^\/+|\/+$/g, '');
  if (!path) return [];
  return path.split('/').filter(Boolean);
}

export function matchRoute(
  pathname: string,
  basePath: string,
  routes: RouteEntry[]
): { view: string; model?: string; id?: string } {
  const segments = relativeSegments(pathname, basePath);
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const captured: { model?: string; id?: string } = {};
    let ok = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const token = route.pattern[i]!;
      const seg = segments[i]!;
      if (token === ':model') {
        captured.model = seg;
      } else if (token === ':id') {
        captured.id = seg;
      } else if (token !== seg) {
        ok = false;
        break;
      }
    }
    if (ok) return { view: route.view, ...captured };
  }
  return { view: 'notFound' };
}

export function parseRoute(pathname: string, basePath: string): ParsedRoute {
  return matchRoute(pathname, basePath, BUILTIN_ROUTES) as ParsedRoute;
}
```

Do **not** add a generic `token.startsWith(':')` branch: only `:model` and `:id` capture. Any other `:foo` would be an untested branch (coverage gate). Literal `'graph'` is a static token.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/router.test.ts`

Expected: PASS (all previous `parseRoute` cases plus the new describe).

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/router.ts tests/unit/router.test.ts
git commit -m "$(cat <<'EOF'
refactor: make admin routing a pattern table with matchRoute

EOF
)"
```

---

### Task 2: Layout extraStyles / extraScripts slots

**Files:**
- Modify: `src/lib/server/views/types.ts` (types for later tasks live here too — add only if you prefer; Layout does not need them)
- Modify: `src/lib/server/views/Layout.svelte`
- Test: `tests/unit/views/layout.test.ts`

**Interfaces:**
- Consumes: existing Layout props (`content`, `config`, `modelList`, `currentModel`).
- Produces: optional `extraStyles?: string` (default `''`) and `extraScripts?: string` (default `''`). Empty → no extra `<style>` / no `<script>` node. Non-empty `extraStyles` injected in `<head>` after the theme `<style>`; non-empty `extraScripts` injected at end of `<body>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/views/layout.test.ts`:

```ts
describe('Layout.svelte — extraStyles / extraScripts', () => {
  it('n’injecte aucun <script> par défaut', () => {
    const html = renderLayout('X', { prisma: {} });
    expect(html).not.toContain('<script>');
  });

  it('n’injecte pas un <style> plugin vide en plus du thème', () => {
    const html = renderLayout('X', { prisma: {} });
    const pluginStyle = html.match(/<style>\s*<\/style>/g);
    expect(pluginStyle).toBeNull();
    expect(html).not.toContain('.ska-plugin-x');
  });

  it('injecte extraStyles dans le head', () => {
    const html = render(Layout, {
      props: {
        content: 'X',
        config: { prisma: {} },
        modelList: models,
        extraStyles: '.ska-plugin-x{color:red}'
      }
    }).body;
    expect(html).toContain('.ska-plugin-x{color:red}');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('.ska-plugin-x{color:red}');
  });

  it('injecte extraScripts en fin de body', () => {
    const html = render(Layout, {
      props: {
        content: 'X',
        config: { prisma: {} },
        modelList: models,
        extraScripts: 'window.__ska=1'
      }
    }).body;
    expect(html).toContain('<script>window.__ska=1</script>');
    expect(html.lastIndexOf('<script>')).toBeGreaterThan(html.indexOf('</main>'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/views/layout.test.ts`

Expected: FAIL — unknown props / no `<script>window.__ska=1</script>`.

- [ ] **Step 3: Add the props and conditionals**

In `Layout.svelte` `$props()`, add defaults:

```ts
let {
  content,
  config,
  modelList,
  currentModel,
  extraStyles = '',
  extraScripts = ''
}: {
  content: string;
  config: AdminHandlerConfig;
  modelList: Array<{ name: string; label: string }>;
  currentModel?: string;
  extraStyles?: string;
  extraScripts?: string;
} = $props();
```

In `<head>`, immediately after the existing theme `{@html `<style>${styles(primaryColor)}</style>`}` block, add:

```svelte
  {#if extraStyles}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- plugin CSS is developer-supplied, same trust as branding.primaryColor -->
    {@html `<style>${extraStyles}</style>`}
  {/if}
```

Immediately before `</body>` (after the layout `</div>`):

```svelte
  {#if extraScripts}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- plugin JS is developer-supplied, same trust as branding.primaryColor -->
    {@html `<script>${extraScripts}</script>`}
  {/if}
```

Do not render empty `<style></style>` or `<script></script>` when the strings are `''`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/views/layout.test.ts`

Expected: PASS, including existing branding / logout tests.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/views/Layout.svelte tests/unit/views/layout.test.ts
git commit -m "$(cat <<'EOF'
feat: add empty extraStyles/extraScripts slots on admin Layout

EOF
)"
```

---

### Task 3: Form recordActions slot

**Files:**
- Modify: `src/lib/server/views/types.ts`
- Modify: `src/lib/server/views/Form.svelte`
- Test: `tests/unit/views/form.test.ts`

**Interfaces:**
- Consumes: existing Form props.
- Produces:

```ts
export interface RecordAction {
  label: string;
  href: string;
}
```

Form prop `recordActions?: RecordAction[]` default `[]`. Render a bar **only** when `mode === 'edit'` **and** `recordActions.length > 0`, between the ID subtitle and the form card, **outside** the POST `<form>`. Labels go through Svelte text (escaped). `href` is an attribute.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/views/form.test.ts` (reuse `viewModel` / `renderForm` already in the file):

```ts
describe('Form.svelte — recordActions', () => {
  const item = { id: 1, email: 'a@b.c' };
  const actions = [{ label: '<img>', href: '/admin/user/1/graph' }];

  it('n’affiche aucune barre d’actions par défaut en edit', () => {
    const html = renderForm('edit', viewModel, '/admin', { prisma: {} } as any, item);
    expect(html).not.toContain('ska-record-actions');
    expect(html).not.toContain('/admin/user/1/graph');
  });

  it('en edit, rend les liens hors du form POST et échappe le label', () => {
    const html = render(Form, {
      props: {
        mode: 'edit',
        model: viewModel,
        basePath: '/admin',
        config: { prisma: {} },
        item,
        recordActions: actions
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph"');
    expect(html).toContain('ska-record-actions');
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
    const formStart = html.indexOf('<form method="POST"');
    const actionHref = html.indexOf('href="/admin/user/1/graph"');
    expect(actionHref).toBeGreaterThan(-1);
    expect(actionHref).toBeLessThan(formStart);
  });

  it('en create, ignore recordActions même non vide', () => {
    const html = render(Form, {
      props: {
        mode: 'create',
        model: viewModel,
        basePath: '/admin',
        config: { prisma: {} },
        recordActions: actions
      }
    }).body;
    expect(html).not.toContain('ska-record-actions');
    expect(html).not.toContain('/admin/user/1/graph');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/views/form.test.ts`

Expected: FAIL — no `ska-record-actions`.

- [ ] **Step 3: Add the type and the bar**

Add to `src/lib/server/views/types.ts`:

```ts
export interface RecordAction {
  label: string;
  href: string;
}

export interface ListRecordAction {
  label: string;
  hrefFor: (id: string | number) => string;
}
```

(`ListRecordAction` is unused until Task 4; adding both now avoids a types-only follow-up. Task 4's tests will cover `hrefFor`.)

In `Form.svelte`, import `RecordAction` from `./types.js` and add `recordActions = []` to `$props()`. After the `{#if mode === 'edit'}` ID subtitle and **before** `<div class="ska-card">`:

```svelte
{#if mode === 'edit' && recordActions.length > 0}
  <div class="ska-record-actions">
    {#each recordActions as action (action.href)}
      <a href={action.href} class="ska-btn ska-btn--secondary ska-btn--sm">{action.label}</a>
    {/each}
  </div>
{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/views/form.test.ts`

Expected: PASS, including existing create/edit field tests.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/views/types.ts src/lib/server/views/Form.svelte tests/unit/views/form.test.ts
git commit -m "$(cat <<'EOF'
feat: add empty recordActions slot on admin edit Form

EOF
)"
```

---

### Task 4: List recordActions slot

**Files:**
- Modify: `src/lib/server/views/List.svelte`
- Test: `tests/unit/views/list.test.ts`

**Interfaces:**
- Consumes: `ListRecordAction` from Task 3 (`{ label: string; hrefFor: (id: string | number) => string }`).
- Produces: prop `recordActions?: ListRecordAction[]` default `[]`. Each row's existing `ska-table__actions` cell renders one `<a>` per action **before** Edit. No extra column. Empty-state `colspan` stays `displayFields.length + 1`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/views/list.test.ts` (reuse `viewModel`, `items`, `empty`):

```ts
describe('List.svelte — recordActions', () => {
  const pagination = { page: 1, perPage: 20, total: 2 };

  it('n’ajoute pas de lien plugin par défaut', () => {
    const html = renderList(viewModel, items, pagination, '/admin', empty);
    expect(html).not.toContain('/admin/user/1/graph');
    expect(html).toContain('>Edit</a>');
  });

  it('appelle hrefFor avec la PK et rend le lien avant Edit', () => {
    const html = render(List, {
      props: {
        model: viewModel,
        items,
        pagination,
        basePath: '/admin',
        config: empty,
        recordActions: [
          { label: '<img>', hrefFor: (id) => `/admin/user/${id}/graph` }
        ]
      }
    }).body;
    expect(html).toContain('href="/admin/user/1/graph"');
    expect(html).toContain('href="/admin/user/2/graph"');
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toMatch(/<td class="ska-table__actions">[^<]*<img>/);
    const row1 = html.slice(html.indexOf('a@b.c'));
    const graphAt = row1.indexOf('href="/admin/user/1/graph"');
    const editAt = row1.indexOf('>Edit</a>');
    expect(graphAt).toBeGreaterThan(-1);
    expect(graphAt).toBeLessThan(editAt);
  });

  it('ne change pas le colspan de la row vide', () => {
    const html = renderList(viewModel, [], { page: 1, perPage: 20, total: 0 }, '/admin', empty);
    expect(html).toMatch(/colspan="7"/);
  });
});
```

`colspan="7"` is `6` data columns + Actions for the default User list (see existing test `['id', 'email', 'name', 'bio', 'role', 'is Active', 'Actions']`). If that existing test ever changes column count, this assertion must follow it — do not add a second Actions `<th>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/views/list.test.ts`

Expected: FAIL — no `/admin/user/1/graph`.

- [ ] **Step 3: Render actions in the existing cell**

In `List.svelte`, import `ListRecordAction` from `./types.js`, add `recordActions = []` to `$props()`. Inside `<td class="ska-table__actions">`, **before** the Edit `<a>`:

```svelte
                {#each recordActions as action (`${action.label}:${item[model.primaryKey]}`)}
                  <a
                    href={action.hrefFor(item[model.primaryKey])}
                    class="ska-btn ska-btn--secondary ska-btn--sm"
                  >{action.label}</a>
                {/each}
```

Do not add a column or change the empty-row `colspan={displayFields.length + 1}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/views/list.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/views/List.svelte tests/unit/views/list.test.ts
git commit -m "$(cat <<'EOF'
feat: add empty recordActions slot on admin List rows

EOF
)"
```

---

### Task 5: `createAdminRuntime`

**Files:**
- Create: `src/lib/server/runtime.ts`
- Create: `tests/unit/runtime.test.ts`
- Modify: `src/lib/server/handler.ts` (boot only — loaders stay as closures that read runtime fields)

**Interfaces:**
- Consumes: `AdminHandlerConfig` via `import type` from `./handler.js` (type-only, no runtime cycle). `config.adapter` is required by the type; `createAdminHandler` still throws if it is missing **before** calling `createAdminRuntime`.
- Produces: `createAdminRuntime(config): AdminRuntime`, named export `scopeFrom` (today's helper, moved).

`AdminRuntime` shape (lock these names — later tasks import them):

```ts
export interface AdminRuntime {
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
  schema: Schema | null;
  relationGraph: RelationGraph | null;
  models: Model[];
  modelList: Array<{ name: string; label: string }>;
  config: AdminHandlerConfig;
  basePath: string;
  perPage: number;
  selectThreshold: number;
  filterLinkThreshold: number;
  labelFieldCandidates: string[];
  findModel(name?: string): Model | undefined;
  labelOf(model: Model): string;
  hiddenFieldsOf(model: Model): Set<string>;
  viewModel(model: Model): ViewModel;
  resolveLabel(
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string;
  resolveFilterableFields(model: Model): Set<string>;
}
```

`perPage` is `20` (today's `PER_PAGE`). Defaults for thresholds / `labelFieldCandidates` stay exactly as in current `handler.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/runtime.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import {
  createPrismaMock,
  FULL_SCHEMA_PATH,
  PIVOT_SCHEMA_PATH,
  SEARCH_SCHEMA_PATH
} from '../fixtures/prismaMock.js';

afterEach(() => vi.restoreAllMocks());

function runtimeFor(
  schemaPath: string,
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({})
) {
  const adapter = createPrismaAdapter({ prisma, schemaPath });
  return createAdminRuntime({ adapter, ...config } as any);
}

describe('createAdminRuntime', () => {
  it('filtre exclude', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { exclude: ['Post'] });
    expect(rt.models.map((m) => m.name)).not.toContain('Post');
    expect(rt.models.map((m) => m.name)).toContain('User');
    expect(rt.findModel('post')).toBeUndefined();
  });

  it('findModel est insensible à la casse', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH);
    expect(rt.findModel('user')?.name).toBe('User');
    expect(rt.findModel('USER')?.name).toBe('User');
  });

  it('labelOf utilise models[].label sinon toLabel capitalisé', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { label: 'Accounts' } } });
    const user = rt.findModel('User')!;
    expect(rt.labelOf(user)).toBe('Accounts');
    const post = rt.findModel('Post')!;
    expect(rt.labelOf(post)).toBe('Post');
  });

  it('hidePivotTables: true masque les pivots (défaut)', () => {
    const rt = runtimeFor(PIVOT_SCHEMA_PATH);
    expect(rt.models.some((m) => m.isPivotTable)).toBe(false);
  });

  it('hidePivotTables: false garde les pivots', () => {
    const rt = runtimeFor(PIVOT_SCHEMA_PATH, { hidePivotTables: false });
    expect(rt.models.some((m) => m.isPivotTable)).toBe(true);
  });

  it('listFilter invalide throw au boot', () => {
    expect(() =>
      runtimeFor(SEARCH_SCHEMA_PATH, { models: { Article: { listFilter: ['nope'] } } })
    ).toThrow(/no field "nope"/);
  });

  it('schéma illisible → models vide + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = {
      introspector: {
        introspect: () => {
          throw new Error('nope');
        }
      },
      data: {} as any
    };
    const rt = createAdminRuntime({ adapter } as any);
    expect(rt.models).toEqual([]);
    expect(rt.schema).toBeNull();
    expect(rt.relationGraph).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('introspect() Promise → même dégradation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = {
      introspector: {
        introspect: () => Promise.resolve({ models: [], enums: new Map(), provider: 'postgresql' })
      },
      data: {} as any
    };
    const rt = createAdminRuntime({ adapter } as any);
    expect(rt.models).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('resolveFilterableFields ferme hidden + sensible + json/bytes/relations', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH, { models: { User: { hidden: ['bio'] } } });
    const user = rt.findModel('User')!;
    const fields = rt.resolveFilterableFields(user);
    expect(fields.has('email')).toBe(true);
    expect(fields.has('password')).toBe(false);
    expect(fields.has('bio')).toBe(false);
    expect(fields.has('metadata')).toBe(false);
    expect(fields.has('avatar')).toBe(false);
    expect(fields.has('posts')).toBe(false);
  });

  it('resolveLabel : template, puis candidat String, sinon PK', () => {
    const rt = runtimeFor(FULL_SCHEMA_PATH);
    const user = rt.findModel('User')!;
    expect(rt.resolveLabel(user, { id: 9, name: 'Ada' }, '{name}#{id}')).toBe('Ada#9');
    expect(rt.resolveLabel(user, { id: 9, name: 'Ada', email: 'a@b.c' })).toBe('Ada');
    expect(rt.resolveLabel(user, { id: 9 })).toBe('9');
  });

  it('perPage vaut 20', () => {
    expect(runtimeFor(FULL_SCHEMA_PATH).perPage).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/runtime.test.ts`

Expected: FAIL — `runtime.js` does not exist.

- [ ] **Step 3: Implement `runtime.ts` and switch handler boot**

Create `src/lib/server/runtime.ts` by **moving** the boot block currently inside `createAdminHandler` (introspect try/catch, `filteredModels`, `hiddenFieldsOf`, `listFilter` validation, `labelOf`, `findModel`, `viewModel`, thresholds, `resolveFilterableFields`, `resolveLabel`) plus `scopeFrom`. Copy comments with the code. Do not change messages or defaults.

```ts
import { isSensitiveFieldName } from './introspection/parser.js';
import type { Schema, Model } from './types/schema.js';
import { buildRelationGraph, type RelationGraph } from './introspection/relations.js';
import { primaryKeyOf } from './data.js';
import { validateListFilterConfig } from './query/filterDetection.js';
import { normalizeScope } from './adapters/filter.js';
import { toLabel } from './views/html.js';
import type { ViewModel } from './views/types.js';
import type { DataAdapter, SchemaIntrospector } from './adapters/types.js';
import type { AdminHandlerConfig } from './handler.js';

export function scopeFrom(
  relConfig: { where?: (ctx: any) => any } | undefined,
  ctx: { locals?: any }
): any {
  return relConfig?.where ? normalizeScope(relConfig.where(ctx)) : undefined;
}

export interface AdminRuntime {
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
  schema: Schema | null;
  relationGraph: RelationGraph | null;
  models: Model[];
  modelList: Array<{ name: string; label: string }>;
  config: AdminHandlerConfig;
  basePath: string;
  perPage: number;
  selectThreshold: number;
  filterLinkThreshold: number;
  labelFieldCandidates: string[];
  findModel(name?: string): Model | undefined;
  labelOf(model: Model): string;
  hiddenFieldsOf(model: Model): Set<string>;
  viewModel(model: Model): ViewModel;
  resolveLabel(
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string;
  resolveFilterableFields(model: Model): Set<string>;
}

export function createAdminRuntime(config: AdminHandlerConfig): AdminRuntime {
  const {
    basePath = '/admin',
    exclude = [],
    hidePivotTables = true,
    models: modelsConfig = {}
  } = config;

  const adapter = config.adapter;
  const introspector: SchemaIntrospector = adapter.introspector;

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
    console.warn('[sveltekit-admin] Could not introspect schema:', e);
  }

  const models = schema?.models.filter((m) => {
    if (exclude.includes(m.name)) return false;
    if (hidePivotTables && m.isPivotTable) return false;
    return true;
  }) || [];

  const hiddenFieldsOf = (m: Model): Set<string> =>
    new Set(modelsConfig[m.name]?.hidden ?? []);

  for (const m of models) {
    const entries = modelsConfig[m.name]?.listFilter;
    if (entries) validateListFilterConfig(m.name, entries, m, relationGraph!, hiddenFieldsOf(m));
  }

  const labelOf = (m: Model) => {
    const configured = modelsConfig[m.name]?.label;
    if (configured) return configured;
    const label = toLabel(m.name);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const modelList = models.map((m) => ({ name: m.name, label: labelOf(m) }));
  const findModel = (name?: string) =>
    models.find((m) => m.name.toLowerCase() === name?.toLowerCase());
  const viewModel = (m: Model): ViewModel => ({
    name: m.name,
    label: labelOf(m),
    fields: m.fields,
    primaryKey: primaryKeyOf(m),
    relationGraph: relationGraph!
  });

  const selectThreshold = config.relationDefaults?.selectThreshold ?? 200;
  const filterLinkThreshold = config.listFilterDefaults?.linkThreshold ?? 20;
  const labelFieldCandidates = config.relationDefaults?.labelFields ?? [
    'name', 'title', 'label', 'email', 'username', 'slug'
  ];

  const resolveFilterableFields = (model: Model): Set<string> => {
    const hidden = hiddenFieldsOf(model);
    const out = new Set<string>();
    for (const f of model.fields) {
      if (f.relation || f.isList) continue;
      if (['Json', 'Bytes'].includes(f.type)) continue;
      if (isSensitiveFieldName(f.name)) continue;
      if (hidden.has(f.name)) continue;
      out.add(f.name);
    }
    return out;
  };

  const resolveLabel = (
    targetModel: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string => {
    if (labelTemplate) {
      return labelTemplate.replace(/\{(\w+)\}/g, (_, k) => String(row[k] ?? ''));
    }
    for (const candidate of labelFieldCandidates) {
      const field = targetModel.fields.find((f) => f.name === candidate);
      if (field && field.type === 'String' && row[candidate] != null) {
        return String(row[candidate]);
      }
    }
    return String(row[primaryKeyOf(targetModel)]);
  };

  return {
    adapter,
    schema,
    relationGraph,
    models,
    modelList,
    config,
    basePath,
    perPage: 20,
    selectThreshold,
    filterLinkThreshold,
    labelFieldCandidates,
    findModel,
    labelOf,
    hiddenFieldsOf,
    viewModel,
    resolveLabel,
    resolveFilterableFields
  };
}
```

In `handler.ts` `createAdminHandler`:

1. Keep the `if (!config.adapter) throw ... requires \`adapter\`.` **before** `createAdminRuntime`.
2. Replace the boot locals with `const runtime = createAdminRuntime(config);` and read `runtime.models` (was `filteredModels`), `runtime.modelList`, `runtime.findModel`, etc.
3. Loaders still in this file must use `runtime.relationGraph`, `runtime.schema`, `runtime.adapter`, `runtime.selectThreshold`, `runtime.resolveLabel`, `runtime.findModel`, `runtime.basePath`, `runtime.filterLinkThreshold`, `scopeFrom` from `./runtime.js`.
4. Delete local `PER_PAGE`; use `runtime.perPage`.
5. Delete local `scopeFrom`; import it from `./runtime.js`.
6. Keep `AdminHandlerConfig` declared in this file.
7. Use `import type` only in `runtime.ts` for `AdminHandlerConfig` so the cycle is type-only.

Existing `tests/unit/handler.core.test.ts` (adapter missing) and `tests/unit/handler.test.ts` (Promise introspect, exclude, hidePivotTables) must still pass — they go through `createAdminHandler`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run tests/unit/runtime.test.ts tests/unit/handler.core.test.ts tests/unit/handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/runtime.ts src/lib/server/handler.ts tests/unit/runtime.test.ts
git commit -m "$(cat <<'EOF'
refactor: extract AdminRuntime boot from createAdminHandler

EOF
)"
```

---

### Task 6: Extract loaders, search, mutations; pass empty slots

**Files:**
- Create: `src/lib/server/relationLoaders.ts`
- Create: `src/lib/server/search.ts`
- Create: `src/lib/server/mutations.ts`
- Modify: `src/lib/server/handler.ts`

**Interfaces:**
- Consumes: `AdminRuntime` from Task 5, `scopeFrom`, `ParsedRoute`.
- Produces:

```ts
export function loadRelationOptions(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: any },
  currentId?: string
): Promise<Map<string, RelationMeta>>;

export function resolveFkFilterOptions(
  runtime: AdminRuntime,
  model: Model,
  fkFieldName: string,
  label: string,
  ctx: { locals?: any },
  activeRawValue: string | undefined
): Promise<FkFilterMeta>;

export function loadRelatedCounts(
  runtime: AdminRuntime,
  model: Model,
  currentId: string
): Promise<Map<string, number>>;

export function handleSearch(runtime: AdminRuntime, event: any): Promise<Response>;

export function handleMutation(
  runtime: AdminRuntime,
  event: any,
  route: ParsedRoute
): Promise<Response | null>;
```

`handleMutation` returns a `Response` when it handled delete/create/update (including the 303). It returns `null` when the POST should fall through to GET (no `route.model`, unknown `_action`, update without `route.id` still 303s today after the create/update block — keep that exact control flow). Read `formData` only when `event.request.method === 'POST'` **inside the handler**, or inside `handleMutation` if the handler only calls it on POST — **do not consume the body on GET**.

Recommended: handler calls `handleMutation` only when `method === 'POST'`. `handleMutation` reads `formData` and returns `null` for unrecognised `_action` (GET render follows; body already consumed — same as today).

- [ ] **Step 1: Characterization as the failing-if-broken suite**

No new assertions. This task is a move. Run the existing nets **before** editing so you have a green baseline:

```bash
pnpm exec vitest run tests/characterization tests/unit/handler.test.ts tests/unit/handler.core.test.ts tests/unit/handler.audit.test.ts tests/unit/search.test.ts tests/unit/fkFilters.test.ts tests/unit/m2mImplicit.test.ts tests/unit/logout.test.ts tests/unit/security.test.ts
```

Expected: PASS (baseline). If red, stop and fix Task 5 first.

- [ ] **Step 2: Move the three functions, keep behavior**

**`relationLoaders.ts`:** cut `loadRelationOptions`, `resolveFkFilterOptions`, `loadRelatedCounts` from `handler.ts`. First argument is `runtime`. Replace closure reads:

| Was | Becomes |
| --- | --- |
| `relationGraph!` | `runtime.relationGraph!` |
| `schema!` | `runtime.schema!` |
| `adapter` | `runtime.adapter` |
| `modelsConfig` | `runtime.config.models ?? {}` |
| `selectThreshold` | `runtime.selectThreshold` |
| `filterLinkThreshold` | `runtime.filterLinkThreshold` |
| `resolveLabel(...)` | `runtime.resolveLabel(...)` |
| `findModel(...)` | `runtime.findModel(...)` |
| `basePath` | `runtime.basePath` |
| `scopeFrom` | import from `./runtime.js` |
| `primaryKeyOf` / `coerceId` / `findFkEdge` | same imports as today |

Keep every comment and the try/catch → raw-id / count 0 / chip-without-label behavior.

**`search.ts`:** cut `handleSearch`. Use `runtime.perPage` instead of `PER_PAGE`, `runtime.findModel`, `runtime.relationGraph`, `runtime.schema`, `runtime.adapter`, `runtime.config.models`, `runtime.labelFieldCandidates`, `runtime.resolveLabel`, `scopeFrom`. Keep `containsExact` and the 404/500 JSON bodies exactly.

**`mutations.ts`:** cut the POST create/update/delete block into `handleMutation`. Use `runtime` for `findModel`, `adapter`, `relationGraph`, `schema`, `hiddenFieldsOf`, `config.models`, `basePath`. Keep `formDataToPrisma`, FK/m2m revalidation, `OPAQUE_FILTER_ERROR` handling, `audit` via `runtime.config.audit`, `redirectToList` using `runtime.basePath`. Throw `Model "…" not found` when `route.model` is set but `findModel` misses — same as today.

`handleMutation` outline:

```ts
export async function handleMutation(
  runtime: AdminRuntime,
  event: any,
  route: ParsedRoute
): Promise<Response | null> {
  const formData = await event.request.formData();
  const action = formData.get('_action');
  if (!route.model) return null;
  const model = runtime.findModel(route.model);
  if (!model) throw new Error(`Model "${route.model}" not found`);

  const redirectToList = (modelName: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${runtime.basePath}/${modelName.toLowerCase()}` }
    });

  const audit = runtime.config.audit;
  // ... existing delete / create / update bodies, then:
  // delete success → return redirectToList(route.model)
  // create/update success → return redirectToList(route.model)
  // unknown action → return null
}
```

Copy the existing loops verbatim (FK owning, m2m `__rel_present__` / `__rel__`, self-ref, safe integer, `emitAudit` / `buildAuditEvent` / `readAuditSnapshot`). Do not add new error types.

- [ ] **Step 3: Thin `handler.ts` and pass empty slots**

`createAdminHandler` after the adapter throw:

```ts
  const runtime = createAdminRuntime(config);
  const { authCheck, logout, logoutRedirectTo = '/' } = config;

  return async ({ event, resolve }: { event: any; resolve: (event: any) => Response | Promise<Response> }) => {
    const { pathname } = event.url;
    if (!pathname.startsWith(runtime.basePath)) return resolve(event);

    const route = parseRoute(pathname, runtime.basePath);

    if (route.view === 'logout') {
      if (event.request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      if (logout) await logout(event);
      return new Response(null, { status: 303, headers: { Location: logoutRedirectTo } });
    }

    if (authCheck) {
      const allowed = await authCheck(event);
      if (!allowed) return new Response('Unauthorized', { status: 401 });
    }

    if (route.view === 'search') return handleSearch(runtime, event);

    let content = '';
    let currentModel: string | undefined;

    try {
      if (event.request.method === 'POST') {
        const mutationResponse = await handleMutation(runtime, event, route);
        if (mutationResponse) return mutationResponse;
      }

      // GET branches stay in this file (not a file-per-view). Mechanical
      // substitutions from the current handler.ts GET block:
      //   filteredModels            → runtime.models
      //   PER_PAGE                  → runtime.perPage
      //   findModel / labelOf / viewModel / hiddenFieldsOf / resolveFilterableFields
      //                             → runtime.*
      //   relationGraph / schema / adapter / modelList / basePath / config
      //                             → runtime.*
      //   modelsConfig              → runtime.config.models ?? {}
      //   labelFieldCandidates      → runtime.labelFieldCandidates
      //   loadRelationOptions(model, ctx, id?)
      //                             → loadRelationOptions(runtime, model, ctx, id?)
      //   resolveFkFilterOptions(model, ...)
      //                             → resolveFkFilterOptions(runtime, model, ...)
      //   loadRelatedCounts(model, id)
      //                             → loadRelatedCounts(runtime, model, id)
      // List props: add recordActions: []
      // Form props (create and edit): add recordActions: []
      // listWhere empty-object throw stays here, unchanged text.
    } catch (e: any) {
      console.error('[sveltekit-admin] Error:', e);
      content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }

    const html = render(Layout, {
      props: {
        content,
        config: runtime.config,
        modelList: runtime.modelList,
        currentModel,
        extraStyles: '',
        extraScripts: ''
      }
    }).body;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  };
```

GET list `listWhere` empty-object throw stays in the handler list branch (not runtime). Pass `recordActions: []` on List and both Form renders.

Remove unused imports from `handler.ts` (`isSensitiveFieldName`, `validateListFilterConfig`, `buildRelationGraph`, `normalizeScope` if unused, etc.). Keep `parseRoute`, `render`, views, `escapeHtml`, `paginate`, `parseListQuery`, `buildWhere`, `resolveSearchFields`, `resolveListFilters`, `toLabel`.

- [ ] **Step 4: Run the nets**

```bash
pnpm exec vitest run tests/characterization tests/unit/handler.test.ts tests/unit/handler.core.test.ts tests/unit/handler.audit.test.ts tests/unit/search.test.ts tests/unit/fkFilters.test.ts tests/unit/m2mImplicit.test.ts tests/unit/logout.test.ts tests/unit/security.test.ts tests/unit/runtime.test.ts tests/unit/views/layout.test.ts tests/unit/views/form.test.ts tests/unit/views/list.test.ts tests/unit/router.test.ts
```

Expected: PASS. Characterization HTML/DB assertions **unchanged**. If a snapshot differs, you changed behavior — revert, do not update snapshots to match a new UI (empty slots must add zero nodes; passing `extraStyles: ''` must not emit an extra `<style>`).

Then coverage on the new modules:

```bash
pnpm exec vitest run tests/unit/runtime.test.ts tests/unit/handler.test.ts tests/unit/search.test.ts tests/unit/fkFilters.test.ts tests/unit/m2mImplicit.test.ts tests/unit/handler.audit.test.ts --coverage
```

Expected: new files at 100%. The `{#if extraStyles}` true branch is covered by Task 2 tests, not the handler (handler always passes `''`).

- [ ] **Step 5: Commit** (skip unless the user asked)

```bash
git add src/lib/server/relationLoaders.ts src/lib/server/search.ts src/lib/server/mutations.ts src/lib/server/handler.ts
git commit -m "$(cat <<'EOF'
refactor: split relation loaders, search, and mutations out of the handler

EOF
)"
```

---

### Task 7: Docs, changeset, full suite

**Files:**
- Modify: `CLAUDE.md` (Request flow + Where behavior lives)
- Create: `.changeset/admin-runtime-extraction.md`

**Interfaces:**
- Consumes: the extracted modules from Tasks 1–6.
- Produces: agent docs that match the new files; patch changelog entry. No `docs/src/lib/content/**` page. No README change. No `index.ts` change.

- [ ] **Step 1: Update `CLAUDE.md` request flow**

Replace the "Request flow" numbered list (the paragraph that says reading `handler.ts` top to bottom is the fastest way) with:

```markdown
Everything funnels through the `handle` hook returned by `createAdminHandler` in `src/lib/server/handler.ts`. Boot lives in `createAdminRuntime` (`runtime.ts`); routing is `router.ts#parseRoute` over `BUILTIN_ROUTES`; loaders / `_search` / POST are `relationLoaders.ts`, `search.ts`, `mutations.ts`.

1. **Boot (once, at handler creation, not per-request)**: `createAdminRuntime` asks `adapter.introspector.introspect()` (must be sync) and runs `buildRelationGraph`. Invalid `models[].listFilter` throws here. Result is an `AdminRuntime` (schema, graph, filtered models, label/hidden/filter helpers) passed into every request.
2. **Routing**: `parseRoute` is `matchRoute(pathname, basePath, BUILTIN_ROUTES)` — dashboard, `_search`, `_logout`, `:model`, `:model/new`, `:model/:id`. Three or more segments stay `notFound`. `matchRoute` accepts extra tables for tests; plugins are not wired yet.
3. **Logout** is special-cased *before* `authCheck` (POST-only).
4. **`authCheck`** runs next; a `false`/rejecting result short-circuits to 401.
5. **POST** (create/update/delete) is `handleMutation`: `formDataToPrisma`, server-side FK/m2m revalidation, then `adapter.data.*`. After a successful write, optional `audit`.
6. **GET** renders Dashboard / List / Form / NotFound via `render()` from `svelte/server`, wrapped in Layout. Layout `extraStyles` / `extraScripts` and Form/List `recordActions` are always passed empty in this version (slots for a future plugin API — no public `plugins` config yet).
```

In "Where behavior actually lives", change the `handler.ts` mentions for FK dropdowns / m2m / inverse counts to `relationLoaders.ts` (still using `RelationGraph`). Add one bullet:

```markdown
- **`runtime.ts`**: boot-time `AdminRuntime`. Not a public export. Future plugins will receive this object instead of talking to Prisma/Drizzle directly.
```

Do not weaken any Security invariants paragraph.

- [ ] **Step 2: Add the patch changeset**

Create `.changeset/admin-runtime-extraction.md`:

```md
---
"sveltekit-admin": patch
---

Extract an internal `AdminRuntime` and a pattern-based route table from `createAdminHandler`, and add empty Layout/Form/List slots for a future plugin API. `createAdminHandler({ prisma })` and `{ adapter }` are unchanged; no new exports or config fields.
```

Patch, not minor: no new consumer-facing export or config option (see `.claude/skills/writing-changesets/SKILL.md`).

- [ ] **Step 3: Full verification**

```bash
pnpm run test
pnpm run check
```

Expected: all tests pass, including characterization + Prisma/Drizzle integration; `svelte-check` clean; coverage 100% on `src/lib/**`. `tests/unit/index.test.ts` still lists the same runtime exports (no `createAdminRuntime`, no `matchRoute`).

If `pnpm run lint` is cheap, run it too. Do not `prettier --write` the whole repo; only format files you touched if lint complains.

- [ ] **Step 4: Commit** (skip unless the user asked)

```bash
git add CLAUDE.md .changeset/admin-runtime-extraction.md
git commit -m "$(cat <<'EOF'
docs: document AdminRuntime extraction and add patch changeset

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| `AdminRuntime` / `createAdminRuntime`, no public export | 5 |
| Adapter throw stays on `createAdminHandler` | 5 |
| `perPage: 20` | 5 |
| `scopeFrom` + `normalizeScope` / `{}` fail-loud unchanged | 5–6 (listWhere throw stays in handler GET) |
| `BUILTIN_ROUTES` + `matchRoute` + `parseRoute` wrapper | 1 |
| 3-segment still `notFound` on `parseRoute` | 1 |
| Extra pattern test (`:model/:id/graph`) | 1 |
| Layout `extraStyles` / `extraScripts`, no empty tags | 2 |
| Form `recordActions` edit-only, escaped label, outside POST form | 3 |
| List `recordActions` in existing Actions cell, `hrefFor`, colspan | 4 |
| `relationLoaders.ts` / `search.ts` / `mutations.ts` | 6 |
| Handler passes `''` / `[]` | 6 |
| Characterization / integration unchanged | 6–7 |
| Patch changeset, `CLAUDE.md`, no docs site page | 7 |
| No `plugins`, no graph, no JSON plugin routes, no nav slot | none by design |
