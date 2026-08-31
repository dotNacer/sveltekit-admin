# Architecture

`sveltekit-admin` is a zero-route admin panel for SvelteKit. The package exports a
`handle` hook; it does not generate or inject SvelteKit route files. Requests under
`basePath` (default `/admin`) are matched and rendered as server-side HTML.

## Repository layout

```text
src/lib/index.ts                  Public root entry point
src/lib/server/handler.ts        Request pipeline and builtin dispatch
src/lib/server/runtime.ts         Boot-time schema, relation graph and config
src/lib/server/router.ts          Builtin and plugin route matching
src/lib/server/mutations.ts       Create, update, delete and bulk delete
src/lib/server/search.ts          JSON search endpoint
src/lib/server/query/             Search, filters, sorting, pagination
src/lib/server/introspection/     Prisma schema parsing and relation graph
src/lib/server/adapters/          Adapter contracts, Prisma and Drizzle adapters
src/lib/server/views/             SSR Svelte views and HTML helpers
src/lib/server/plugin.ts          Public plugin contracts
src/routes/                       Development-only demo harness
example/                          Standalone consumer app
 docs/                             Separate documentation website
 tests/                            Unit and Prisma/Drizzle integration tests
```

Only `dist/` is published. The package's `files` and `exports` entries are the
source of truth for the published surface.

## Public entry points

- `sveltekit-admin`: Prisma handler (`createAdminHandler({ prisma })`),
  `createPrismaAdapter`, schema types, adapter contracts, plugin types and
  `defaultAdminCheck`.
- `sveltekit-admin/adapters/drizzle`: `createDrizzleAdapter` plus the handler,
  auth helper, adapter types and plugin types. This keeps Drizzle-only consumers
  from evaluating the Prisma adapter modules.

The handler also accepts an explicit `{ adapter: { introspector, data } }` pair,
which is the extension point for custom adapters.

## Request pipeline

At handler creation, the runtime synchronously introspects the schema, builds the
relation graph, validates model configuration and resolves plugin routes. This
work is not repeated per request.

For a request under `basePath`:

1. Verify the `Origin` header for state-changing requests (`csrf` is enabled by
   default).
2. Match plugin routes before builtin routes.
3. Dispatch `POST /_logout` before `authCheck`, then run the optional auth check.
4. Serve `_search` as JSON.
5. Serve plugin pages as GET-only SSR views.
6. Handle create/update/delete/bulk-delete mutations with server-side validation,
   scope enforcement and optional audit events, then redirect with `303`.
7. Render builtin dashboard, list and form views as SSR HTML.

Requests outside `basePath` are passed to the consuming SvelteKit application.

## Scope and data flow

`models[].scope(ctx)` is the authorization boundary for a model. It is composed
with reads and writes, including detail, edit, delete, dashboard counts,
relations, search and plugin access. Scoped creates re-apply equality values and
fail closed when the tenant context is missing or ambiguous.

`models[].listWhere(ctx)` is deliberately narrower: it filters list-view data,
search, sidebar filters, FK filters and pagination. It is not a substitute for
`scope`.

Adapters implement the ORM-agnostic `SchemaIntrospector` and `DataAdapter`
contracts. The handler and query layer produce a small `Filter` AST; each adapter
compiles that AST into its ORM's query format.

Sensitive field names (`password`, `hash`, `secret`, `token`) and configured
`hidden` fields are excluded from lists, search, filters, forms, audit payloads
and plugin record payloads. FK and many-to-many values are revalidated on the
server, even when the UI already constrained the choices.

## UI extension points

`plugins` can register extra GET pages, list-row actions, edit-screen actions and
trusted inline CSS/JS. Plugin reads use scoped, redacted contexts and cannot
register an exact builtin route overlay. Plugin pages do not enter the mutation
pipeline.

## Development commands

The repository uses pnpm 10.25.0:

```bash
pnpm install --frozen-lockfile
pnpm run test:gen       # generate the Prisma client used by tests
pnpm run check          # type-check
pnpm run lint           # ESLint
pnpm run test           # full Vitest suite
pnpm run test:coverage  # suite plus v8 coverage
pnpm run package        # build the published dist/
pnpm run smoke:packaged # build and exercise the packed consumer artifact
pnpm run format         # format files
```

The test configuration requires 100% coverage for `src/lib/**`. CI additionally
checks Node 20 and 22, the packed consumer artifact, and Changesets on PRs.

## Releases

Changesets drive versioning. Merging to `main` opens or updates the automated
Version Packages PR; merging that PR versions the package, updates the changelog,
publishes to npm and creates the tag. See `CONTRIBUTING.md`.
