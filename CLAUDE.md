# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sveltekit-admin` is a Django-like admin panel for SvelteKit + Prisma, published as an npm package. It ships **zero routes**: `createAdminHandler({ prisma })` returns a SvelteKit `handle` hook (`src/hooks.server.ts`) that intercepts every request under `basePath` (default `/admin`) and renders HTML on the fly — no `+page.svelte` files are generated or required in the consuming app. The published entry point is `src/lib/index.ts`; everything under `src/lib/server/` is the implementation.

`src/routes/+page.svelte` and the rest of `src/routes/` are only a throwaway dev harness for `bun run dev` — not part of the published package (see `package.json`'s `files` field: only `dist` ships).

`example/` is a separate, standalone SvelteKit app (its own `package.json`, own `bun.lock`) that consumes the library via `link:..` — useful for manually exercising a real Prisma + better-auth setup, not part of the test suite.

`docs/` is a second, fully independent SvelteKit project (a documentation website with its own `.svelte-kit`, routes, content) — not the library, don't confuse the two when navigating.

## Commands

Package manager is **bun** (`bun.lock` committed, no `package-lock.json` — CI installs with `bun install --frozen-lockfile`, not `npm ci`).

```bash
bun run dev              # dev harness (src/routes) against the demo Prisma setup
bun run test:gen         # generate the Prisma client used by tests, into tests/fixtures/prisma/client/ (gitignored)
bun run test             # svelte-kit sync + test:gen + vitest run — the full suite once
bun run test:watch       # same, watch mode
bun run test:coverage    # same + v8 coverage report (text/html/lcov)
bun run check            # svelte-kit sync + svelte-check (type checking)
bun run lint             # svelte-kit sync + eslint .
bun run format           # prettier --write .
bun run package          # svelte-kit sync + svelte-package -o dist (what actually gets published)
bun run size             # package + reports unpacked size (scripts/package-size.mjs)
```

Run a single test file or test case with vitest directly (after `bun run test:gen` has been run at least once):

```bash
bunx vitest run tests/unit/listQuery.test.ts
bunx vitest run -t "some test name"
```

`vitest.config.ts` enforces **100% coverage** (lines/statements/functions/branches) on `src/lib/**`. There is no `exclude` escape hatch and no `/* v8 ignore */` convention in this codebase — every branch you add needs a real test, not a suppression. Don't introduce defensive code paths that can't be exercised (see the "no code for hypothetical inputs" style already in the source — e.g. `data.ts`'s comment on why `listRecords` doesn't reuse `paginate`, or `filterDetection.ts`'s comment on why an unreachable `default` case is left uncovered-but-necessary only when TypeScript requires it).

`tests/integration/setup.ts` (Vitest `globalSetup`) spins up a throwaway SQLite DB via `prisma db push` for `tests/integration/handler.db.test.ts`; unit tests instead use the mock in `tests/fixtures/prismaMock.ts`.

CI (`.github/workflows/ci.yml`) also runs a `changeset-check` job on PRs (`bunx changeset status --since=origin/main`) that fails if publishable source changed without an added `.changeset/*.md`.

## Versioning & releases

Semantic Versioning, enforced via [Changesets](https://github.com/changesets/changesets) — see `CONTRIBUTING.md` for the exact MAJOR/MINOR/PATCH rules. Any PR that changes published behavior needs `bunx changeset` (or the `writing-changesets` skill) before merge; pure test/CI/tooling PRs don't. Releases are fully automated: merging to `main` runs `.github/workflows/release.yml`, which opens/updates a "Version Packages" PR via `changesets/action`; merging *that* PR bumps `package.json`, regenerates `CHANGELOG.md`, tags, and publishes to npm. Nothing is versioned or published by hand.

## Request flow (the core mental model)

Everything funnels through the single `handle` hook returned by `createAdminHandler` in `src/lib/server/handler.ts`. Reading that file top to bottom, in request order, is the fastest way to understand the whole system:

1. **Boot (once, at handler creation, not per-request)**: `parsePrismaSchema` (`introspection/parser.ts`) regex-parses the `.prisma` schema file into `PrismaSchema` (models/fields/enums/provider) — no Prisma SDK dependency, no AST. `buildRelationGraph` (`introspection/relations.ts`) is a post-processing pass over that raw AST that pairs relation fields into a `RelationGraph` of typed edges (`to-one-owning` / `to-one-inverse` / `to-many-inverse` / `m2m-implicit`), and flags what it can't safely support (`composite-fk`, `ambiguous` relation groups) rather than guessing. Any `models[].listFilter` config is validated against the schema here too — invalid config throws at boot, not at render time.
2. **Routing**: `router.ts#parseRoute` maps a pathname (relative to `basePath`) to `{ view, model?, id? }` — a pure, dependency-free function, easy to unit test in isolation from the handler.
3. **Logout** is special-cased *before* `authCheck` runs (a user with an expired session must still be able to clear client-side state) and is POST-only by construction (a GET must never trigger a side effect).
4. **`authCheck`** runs next; a `false`/rejecting result short-circuits to 401 before any model logic executes.
5. **POST** (create/update/delete) is handled inline in the hook: `formDataToPrisma` (`data.ts`) converts the `FormData` per field type, then FK scalars and implicit-m2m relations are independently re-validated server-side (existence + configured scoping `where`, self-reference checks, safe-integer checks) — this is deliberate defense against a forged POST bypassing what the rendered `<select>` would have restricted.
6. **GET** dispatches to one of the Svelte view components (`views/Dashboard.svelte`, `views/List.svelte`, `views/Form.svelte`, `views/NotFound.svelte`), each rendered server-side via `render()` from `svelte/server` (not SvelteKit's router — these are SSR HTML fragments, which is also why `eslint.config.js` turns off `svelte/no-navigation-without-resolve` for `**/*.svelte`), wrapped in `views/Layout.svelte`.

## Where behavior actually lives

- **`introspection/parser.ts`**: regex-based `.prisma` parsing. Also owns `isSensitiveFieldName` — the **single shared predicate** (substring match on `password`/`hash`/`secret`/`token`) used by both the list-view display logic *and* the query/filter whitelist in `query/listQuery.ts`. If you add a new place that decides whether a field is sensitive, it must reuse this predicate, not reimplement it — a second heuristic drifting from this one is exactly the class of bug this codebase has already fixed once.
- **`introspection/relations.ts`**: relation-field pairing. Golden rule documented at the top of the file — never pair two relation fields by "same target model," always by relation name (a model can have two relations to the same target, e.g. `Post { author User, reviewer User }`). Produces the `RelationGraph` that `handler.ts` uses for FK dropdowns, m2m checkboxes, inverse-relation counts on edit forms, and FK sidebar filters.
- **`query/listQuery.ts`**: turns `?q=` and `?f.<field>[__<op>]=` query params into a Prisma `where`. The operator space is a fixed whitelist keyed off the field's Prisma type (`allowedOpsFor`) — the URL's operator string is only ever used as a lookup key into that table, never passed through to a Prisma clause key directly. `buildWhere` always composes scope + filters via `AND` (array), **never object spread** — spreading would let a URL-supplied filter on the same field silently overwrite a developer's `listWhere` scope.
- **`query/filterDetection.ts`**: resolves the list-view sidebar. Auto-detection is deliberately narrow (Boolean + enum only, because their value domain is known statically from the schema with zero extra query); DateTime/numeric-range/FK filters require explicit `models[].listFilter` config, validated at boot.
- **`data.ts`**: thin Prisma CRUD wrappers plus the FormData → Prisma payload conversion and the model-name-to-Prisma-client-key convention (`toPrismaModel`: `User` → `prisma.user`).
- **`views/*.svelte` + `views/html.ts`**: server-rendered UI. `html.ts` has `escapeHtml`/`toLabel` helpers used wherever raw strings get interpolated outside a Svelte template's auto-escaping.
- **`auth.ts`**: `defaultAdminCheck` is an optional convenience helper (checks `role`/`isAdmin`/`roles` on a user object) — most consumers pass their own `authCheck` closure instead.

## Security invariants worth knowing before touching handler.ts or query/*

These aren't incidental — they're fixes for specific IDOR/oracle classes found in review, and re-introducing them is the most likely way to regress this codebase silently (tests may still pass if the new test doesn't specifically probe for it):

- A field hidden via `models[].hidden` or matched by `isSensitiveFieldName` must be unreachable through **every** path — list display, `?q=` search, and `?f.*=` filters — not just the one path a given feature happened to be built for. Two independent code paths currently enforce this (config-driven `hidden` sets and the shared sensitive-name predicate); both must stay closed.
- `listWhere` (and a relation's `relations[field].where`) scope only the **list view** (search, sidebar filters, FK filter, pagination). Detail/edit/delete/dashboard counts have no per-record scoping hook at all in this version and stay fully open regardless — don't assume `listWhere` protects them, and don't document/imply that it does.
- A `listWhere`/`where` scope function that returns `{}` throws rather than being treated as "no scope" — an empty object composed into `AND` matches every row, i.e. silently fails *open* exactly when the caller (e.g. a `locals.userId` that turned out to be `undefined`) most needed protection.
- FK/m2m values submitted via POST are re-validated server-side (existence + the same scoping `where` used to build the dropdown) even though the rendered `<select>` already restricts them — a forged POST must not bypass scoping just because the UI wouldn't have offered that value.
- An FK filter's active-value "chip" resolves its label through the same scoped query as its options list; an out-of-scope id renders as a raw id, never a label — otherwise the chip becomes an oracle for guessing another tenant's record names.

## Notes on source comments

Many comments in `src/lib/server/**` cite section numbers from a `docs/design/*.md` doc (e.g. `list-search-filters.md §4.3`, `relations.md §1`). **That design doc does not exist in this checkout** — don't spend time hunting for it; treat the inline comments as the authoritative explanation of the "why" instead. A large fraction of comments in the query/filter/relations modules are in French; this is the existing convention in those files, not an inconsistency to "fix."
