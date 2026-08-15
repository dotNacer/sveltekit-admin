# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sveltekit-admin` is a Django-like admin panel for SvelteKit + Prisma, published as an npm package. It ships **zero routes**: `createAdminHandler({ prisma })` returns a SvelteKit `handle` hook (`src/hooks.server.ts`) that intercepts every request under `basePath` (default `/admin`) and renders HTML on the fly — no `+page.svelte` files are generated or required in the consuming app. The published entry point is `src/lib/index.ts`; everything under `src/lib/server/` is the implementation.

`src/routes/+page.svelte` and the rest of `src/routes/` are only a throwaway dev harness for `pnpm run dev` — not part of the published package (see `package.json`'s `files` field: only `dist` ships).

`example/` is a separate, standalone SvelteKit app (its own `package.json`, own `pnpm-lock.yaml`) that consumes the library via `link:..` — useful for manually exercising a real Prisma + better-auth setup, not part of the test suite.

`docs/` is a second, fully independent SvelteKit project (a documentation website with its own `.svelte-kit`, routes, content) — not the library, don't confuse the two when navigating.

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml` committed, no `package-lock.json` — CI installs with `pnpm install --frozen-lockfile`, not `npm ci`).

```bash
pnpm run dev              # dev harness (src/routes) against the demo Prisma setup
pnpm run test:gen         # generate the Prisma client used by tests, into tests/fixtures/prisma/client/ (gitignored)
pnpm run test             # svelte-kit sync + test:gen + vitest run — the full suite once
pnpm run test:watch       # same, watch mode
pnpm run test:coverage    # same + v8 coverage report (text/html/lcov)
pnpm run check            # svelte-kit sync + svelte-check (type checking)
pnpm run lint             # svelte-kit sync + eslint .
pnpm run format           # prettier --write .
pnpm run package          # svelte-kit sync + svelte-package -o dist (what actually gets published)
pnpm run size             # package + reports unpacked size (scripts/package-size.mjs)
```

Run a single test file or test case with vitest directly (after `pnpm run test:gen` has been run at least once):

```bash
pnpm exec vitest run tests/unit/listQuery.test.ts
pnpm exec vitest run -t "some test name"
```

`vitest.config.ts` enforces **100% coverage** (lines/statements/functions/branches) on `src/lib/**`. There is no `exclude` escape hatch and no `/* v8 ignore */` convention in this codebase — every branch you add needs a real test, not a suppression. Don't introduce defensive code paths that can't be exercised (see the "no code for hypothetical inputs" style already in the source — e.g. `data.ts`'s comment on why `listRecords` doesn't reuse `paginate`, or `filterDetection.ts`'s comment on why an unreachable `default` case is left uncovered-but-necessary only when TypeScript requires it).

`tests/integration/setup.ts` (Vitest `globalSetup`) spins up a throwaway SQLite DB via `prisma db push` for `tests/integration/handler.db.test.ts`; unit tests instead use the mock in `tests/fixtures/prismaMock.ts`.

CI (`.github/workflows/ci.yml`) also runs a `changeset-check` job on PRs (`pnpm exec changeset status --since=origin/main`) that fails if publishable source changed without an added `.changeset/*.md`.

## Versioning & releases

Semantic Versioning, enforced via [Changesets](https://github.com/changesets/changesets) — see `CONTRIBUTING.md` for the exact MAJOR/MINOR/PATCH rules. Any PR that changes published behavior needs `pnpm exec changeset` (or the `writing-changesets` skill) before merge; pure test/CI/tooling PRs don't. Releases are fully automated: merging to `main` runs `.github/workflows/release.yml`, which opens/updates a "Version Packages" PR via `changesets/action`; merging *that* PR bumps `package.json`, regenerates `CHANGELOG.md`, tags, and publishes to npm. Nothing is versioned or published by hand.

## Request flow (the core mental model)

Everything funnels through the `handle` hook returned by `createAdminHandler` in `src/lib/server/handler.ts`. Boot lives in `createAdminRuntime` (`runtime.ts`) and `resolvePluginRegistry` (`pluginRegistry.ts`); routing is `router.ts#matchRoute` over `[...registry.routes, ...BUILTIN_ROUTES]`; loaders / `_search` / POST are `relationLoaders.ts`, `search.ts`, `mutations.ts`.

1. **Boot (once, at handler creation, not per-request)**: `createAdminRuntime` asks `adapter.introspector.introspect()` (must be sync) and runs `buildRelationGraph`. Invalid `models[].listFilter` throws here. Result is an `AdminRuntime` (schema, graph, filtered models, label/hidden/filter helpers) passed into every request. `resolvePluginRegistry(config.plugins ?? [], BUILTIN_ROUTES, runtime.models)` also runs here and throws on an invalid plugin.
2. **Routing**: `parseRoute` is no longer what the handler uses. The handler calls `matchRoute(pathname, basePath, [...pluginRoutes, ...BUILTIN_ROUTES])` (plugin routes first). `parseRoute` remains builtins-only for tests. Plugin patterns such as `[':model', ':id', 'graph']` match when registered; without `plugins` they stay `notFound`. Do **not** write builtins-first: that order makes `['hello']` and `[':model','stats']` unreachable.
3. **Logout** is special-cased *before* `authCheck` (POST-only).
4. **`authCheck`** runs next; a `false`/rejecting result short-circuits to 401.
5. After authCheck / search: plugin views, non-GET → 405; GET → scoped preload + `render` in Layout.
6. **POST** (create/update/delete) is `handleMutation`: `formDataToPrisma`, server-side FK/m2m revalidation, then `adapter.data.*`. After a successful write, optional `audit`. Plugin pages are GET-only and never reach this branch.
7. **GET** builtin: Form/List `recordActions` come from the plugin registry (empty if no plugins). Layout `extraStyles` / `extraScripts` are filled only on plugin pages.

## Where behavior actually lives

- **`introspection/parser.ts`**: regex-based `.prisma` parsing. Also owns `isSensitiveFieldName` — the **single shared predicate** (substring match on `password`/`hash`/`secret`/`token`) used by both the list-view display logic *and* the query/filter whitelist in `query/listQuery.ts`. If you add a new place that decides whether a field is sensitive, it must reuse this predicate, not reimplement it — a second heuristic drifting from this one is exactly the class of bug this codebase has already fixed once.
- **`introspection/relations.ts`**: relation-field pairing. Golden rule documented at the top of the file — never pair two relation fields by "same target model," always by relation name (a model can have two relations to the same target, e.g. `Post { author User, reviewer User }`). Produces the `RelationGraph` that `relationLoaders.ts` uses for FK dropdowns, m2m checkboxes, inverse-relation counts on edit forms, and FK sidebar filters.
- **`runtime.ts`**: boot-time `AdminRuntime`. Not a public export. Plugin pages don't receive it directly — `pluginAccess.ts` wraps it into the narrower `PluginPageContext` instead.
- **`query/listQuery.ts`**: turns `?q=` and `?f.<field>[__<op>]=` query params into a Prisma `where`. The operator space is a fixed whitelist keyed off the field's Prisma type (`allowedOpsFor`) — the URL's operator string is only ever used as a lookup key into that table, never passed through to a Prisma clause key directly. `buildWhere` always composes scope + filters via `AND` (array), **never object spread** — spreading would let a URL-supplied filter on the same field silently overwrite a developer's `listWhere` scope.
- **`query/filterDetection.ts`**: resolves the list-view sidebar. Auto-detection is deliberately narrow (Boolean + enum only, because their value domain is known statically from the schema with zero extra query); DateTime/numeric-range/FK filters require explicit `models[].listFilter` config, validated at boot.
- **`data.ts`**: thin Prisma CRUD wrappers plus the FormData → Prisma payload conversion and the model-name-to-Prisma-client-key convention (`toPrismaModel`: `User` → `prisma.user`).
- **`views/*.svelte` + `views/html.ts`**: server-rendered UI. `html.ts` has `escapeHtml`/`toLabel` helpers used wherever raw strings get interpolated outside a Svelte template's auto-escaping.
- **`auth.ts`**: `defaultAdminCheck` is an optional convenience helper (checks `role`/`isAdmin`/`roles` on a user object) — most consumers pass their own `authCheck` closure instead.
- **`audit.ts`**: builds and emits the optional `audit` callback payload after successful writes. Redaction reuses `isSensitiveFieldName` plus `models[].hidden`; diffs and best-effort `emitAudit` live here so `handler.ts` only wires the three write sites.
- **`plugin.ts` / `pluginRegistry.ts` / `pluginAccess.ts`**: public `AdminPlugin` contract, boot validation (no builtin overlay, no duplicate patterns), scoped reads for plugin pages. Not a public runtime export.

## Security invariants worth knowing before touching handler.ts or query/*

These aren't incidental — they're fixes for specific IDOR/oracle classes found in review, and re-introducing them is the most likely way to regress this codebase silently (tests may still pass if the new test doesn't specifically probe for it):

- A field hidden via `models[].hidden` or matched by `isSensitiveFieldName` must be unreachable through **every** path — list display, `?q=` search, `?f.*=` filters, **and the `audit` payload** (`values` / `before` / `after` / `changes`) — not just the one path a given feature happened to be built for. Two independent code paths currently enforce this (config-driven `hidden` sets and the shared sensitive-name predicate); both must stay closed.
- `listWhere` (and a relation's `relations[field].where`) scope only the **list view** (search, sidebar filters, FK filter, pagination). Detail/edit/delete/dashboard counts have no per-record scoping hook at all in this version and stay fully open regardless — don't assume `listWhere` protects them, and don't document/imply that it does.
- A `listWhere`/`where` scope function that returns `{}` throws rather than being treated as "no scope" — an empty object composed into `AND` matches every row, i.e. silently fails *open* exactly when the caller (e.g. a `locals.userId` that turned out to be `undefined`) most needed protection.
- FK/m2m values submitted via POST are re-validated server-side (existence + the same scoping `where` used to build the dropdown) even though the rendered `<select>` already restricts them — a forged POST must not bypass scoping just because the UI wouldn't have offered that value.
- An FK filter's active-value "chip" resolves its label through the same scoped query as its options list; an out-of-scope id renders as a raw id, never a label — otherwise the chip becomes an oracle for guessing another tenant's record names.
- Plugin page context has no `adapter`. Record payloads from `loadRecord` / `listRecords` / the preloaded `record` are redacted with `redactForAudit` (`hidden` + `isSensitiveFieldName`). Out-of-`listWhere` `:id` is 404 before `render`. This does not scope builtin edit/delete.
- Non-GET requests to a plugin view are 405; `handleMutation` stays on builtin list/create/edit only.

## Notes on source comments

Many comments in `src/lib/server/**` cite section numbers from a `docs/design/*.md` doc (e.g. `list-search-filters.md §4.3`, `relations.md §1`). **That design doc does not exist in this checkout** — don't spend time hunting for it; treat the inline comments as the authoritative explanation of the "why" instead. A large fraction of comments in the query/filter/relations modules are in French; this is the existing convention in those files, not an inconsistency to "fix."
