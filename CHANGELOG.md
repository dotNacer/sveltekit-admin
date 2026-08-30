# Changelog

## 0.8.1

### Patch Changes

- a11ad81: A failed create or update no longer renders the database driver's own error message. Prisma's `P2002` used to reach the browser as ``Invalid `prisma.user.create()` invocation … Unique constraint failed on the fields: (`email`)``, query text included; unique, foreign-key and missing-row failures are now recognized by driver code (Prisma, PostgreSQL, MySQL, SQLite) and rendered as a fixed library message, with anything unrecognized logged server-side and shown as a generic one.

  Validation refusals raised by the admin itself are unchanged, word for word — an invalid relation target still reads `author: invalid value`. Internally they carry a kind and a field instead of being recognized by substring matching on their own message, which is what made the leak possible to fix without touching them. Plugin pages and failed list reads keep rendering exactly as before.

  A `models[].scope` misconfiguration (missing tenant value, non-equality condition, an empty scope object) still throws its own developer-facing `AdminConfigError` message unchanged — that path is deliberately exempt from the new masking, since it's meant for the integrator, not the admin user.

## 0.8.0

### Minor Changes

- 3bda2dc: Verify the `Origin` header on every state-changing request the admin serves (create, update, delete, `_logout`, `_search`), and add a **`csrf`** option (`false | { trustedOrigins?: string[] }`). The check runs before routing, so it covers `_logout` (dispatched before `authCheck` by design) and any route added later; a rejected request gets a static `403` and never reaches the adapter. `GET`/`HEAD`/`OPTIONS` and anything outside `basePath` are untouched.

  SvelteKit's `kit.csrf.checkOrigin` can't carry this guarantee for the admin: it runs before the `handle` hook so the handler never observes it, a `checkOrigin: false` set for an unrelated route (a payment webhook, say) disables it everywhere, and it is skipped in development — so a proxy that strips `Origin` only surfaces in production. A missing `Origin` is rejected, matching SvelteKit's semantics. `trustedOrigins` entries are normalized at startup (`https://ops.example.com/` and `https://ops.example.com` are one entry); an entry that is not an absolute URL, or whose origin is opaque (`"null"`, as a sandboxed iframe sends), throws from `createAdminHandler` rather than being ignored per-request. This is a cross-site defense only: with no per-session token, a compromised same-origin context needs origin isolation.

- f5384a3: Add model-level `scope(ctx)` tenant isolation across reads, mutations, relation options, search, dashboard counts, and plugin access. Scoped creates force equality scope fields and fail closed when the tenant context is missing or ambiguous. The forced values are re-applied after foreign-key revalidation, which matters when the tenant column is itself a relation scalar such as `organizationId` — the common case. A submitted value that conflicts with the scope is rejected rather than written, for every scope column: the value is server-determined, so a mismatch is either a forged POST or a form offering a choice it should not offer, and silently correcting it would hide both. Only a value the client actually asserted is checked: a scope column absent from the form, or present but left empty — which is what a create form renders — is simply set, since an empty field is not a claim to another tenant.

  Relation targets submitted by a POST are re-checked inside the write transaction. On PostgreSQL that check now takes a `FOR SHARE` row lock, because `SERIALIZABLE` alone does not prevent a concurrent transaction from moving the target out of scope between the check and the write — PostgreSQL's SSI finds no dependency cycle in that sequence and lets both transactions commit. MySQL is unaffected: `SERIALIZABLE` already turns those reads into locking reads there, and `FOR SHARE` is 8.0-only syntax. Guards are locked in a deterministic `(model, primary key)` order, so two concurrent requests submitting the same relation ids in a different order cannot deadlock each other.

  The Drizzle `deleteRecord` no longer issues a verification `SELECT` before deleting: the scoped `DELETE` is itself the guard, and a zero-row result rolls the pivot deletions back. This removes the window between the check and the delete.

  Transactional writes are retried on a serialization failure or deadlock (PostgreSQL `40001`/`40P01`, MySQL `ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT`), up to three attempts. Those engine errors mean the transaction was rolled back whole and wrote nothing, so replaying it is safe and avoids surfacing a transient conflict as a 500. Nothing else is retried — an authorization refusal is not transient, and replaying it would only repeat the same refusal.

## 0.7.0

### Minor Changes

- a5d9ab8: Re-export `createAdminHandler` and `defaultAdminCheck` from `sveltekit-admin/adapters/drizzle`, so a Drizzle-only app can import the handler and `createDrizzleAdapter` from one subpath without evaluating the Prisma adapter modules. `createAdminHandler({ prisma })` from `sveltekit-admin` is unchanged; importing the handler from the root entry plus the Drizzle adapter from the subpath still works, but that path keeps loading the Prisma adapter JavaScript.
- b7e5630: Add a **`plugins`** option on `createAdminHandler` and export the `AdminPlugin` types (new pages inside the existing layout, record-row / edit-screen links, inline CSS/JS). Plugin reads go through scoped helpers (`listWhere` plus `hidden` / sensitive-field redaction), not the ORM client. Omitting `plugins` leaves `createAdminHandler({ prisma })` unchanged.
- 3cfc154: Add an optional **`audit`** callback on `createAdminHandler`. After a successful create, update, or delete it receives a redacted `AuditEvent` (`action`, `model`, `id`, `values` / `before` / `after` / `changes`, plus the SvelteKit `event` so the actor can be read from `locals`). Sensitive and `hidden` fields are stripped. If the callback throws, the mutation still redirects (the error is logged). No callback means no behavior change.

### Patch Changes

- 07a390e: Extract an internal `AdminRuntime` and a pattern-based route table from `createAdminHandler`, and add empty Layout/Form/List slots for a future plugin API. `createAdminHandler({ prisma })` and `{ adapter }` are unchanged; no new exports or config fields.

## 0.6.0

### Minor Changes

- de9ed24: Extract a generic `SchemaIntrospector`/`DataAdapter` abstraction behind Prisma, exposed as `createPrismaAdapter`. `createAdminHandler({ prisma, prismaSchemaPath })` keeps working exactly as before; `createAdminHandler({ adapter })` is now also available for anyone building a custom or future non-Prisma adapter.
- c0008d1: Add a **Drizzle** adapter, imported from `sveltekit-admin/adapters/drizzle` as `createDrizzleAdapter({ db, schema })`, with list/form/dashboard, relations, m2m, filters, and flat `listWhere` parity. `createAdminHandler({ prisma })` is unchanged; `@prisma/client` and `drizzle-orm` are optional peer dependencies so a Drizzle-only app no longer needs Prisma, and a Prisma-only app never has to install `drizzle-orm`.

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.3] - 2026-08-13

### Changed

- Parallelized independent Prisma queries that were previously awaited
  sequentially in a loop: relation options on create/edit forms
  (`loadRelationOptions`), inverse-relation counts on the "Related" block
  (`loadRelatedCounts`), FK list filters on list views, and the
  options/active-label resolution within a single FK filter. A model with
  several relations or FK filters no longer stacks one DB round trip per
  relation/filter on a single request.

### Fixed

- `scripts/package-size.mjs` (dev tooling, not published) failed to parse
  `bun pm pack --dry-run` output because `bun` emits ANSI color codes even
  when not attached to a TTY — every release since this script was added
  silently had no real gzip size measurement. Package size itself is
  unaffected: 48.31KB gzip / 180.66KB unpacked, zero runtime dependencies.

## [0.5.2] - 2026-08-13

### Changed

- Redesigned the list-view filter sidebar: options render as compact,
  wrapping pill buttons instead of a vertical list of links, cutting the
  filter card's height dramatically on models with several facets or
  many enum values. Also styled the FK select/raw-id inputs, the active
  FK chip, and the numeric range inputs, which previously had no CSS at
  all (unstyled browser defaults).

## [0.5.1] - 2026-08-13

### Changed

- Widened the default free-text search heuristic: `description`, `content`,
  `body`, and `text` are now recognized alongside `name`, `title`, `label`,
  `email`, `username`, `slug` when auto-detecting searchable String fields
  (no `searchFields` configured). This list is separate from — and no
  longer described as identical to — the one used to label relations.

## [0.5.0] - 2026-08-12

### Added

- **Free-text search and query pipeline for list views**:
  - `?q=` search box on list views, matching `searchFields` configured
    per model (or auto-detected String fields when unspecified)
  - Per-field-type operator rules: `contains` on plain String fields,
    `equals` (never `contains`) on `@id` fields — a field being coercible
    to a search-friendly comparison is checked per type, never assumed
- **Boolean and enum filter sidebar** on list views: auto-detected
  Boolean/enum fields (or explicitly configured via `listFilter`) render
  as sidebar filter groups, composed via `AND` with active search/other
  filters
- **DateTime presets and numeric range filters**: quick date-range chips
  (today/7 days/this month/this year) plus manual `gte`/`lte` bounds for
  DateTime and numeric fields
- **FK scalar list filter**, IDOR-safe: filtering a list by a foreign-key
  column resolves the active filter's chip label via a scoped `findFirst`
  (never a bare `findUnique`, never trusts a raw ID as identity proof) —
  a filter can never leak another tenant's row label even when the
  underlying FK column itself isn't tenant-scoped
- New per-model config options: `searchFields`, `listFilter`,
  `listFilterDefaults` (thresholds, presets, ordering)
- **Logout support**, same "bring your own auth" philosophy as `authCheck`:
  - New `logout` config option — a function you provide to clear your
    session (a cookie, an auth library's sign-out call, whatever your app
    uses). The library has no session system of its own, so it can't know
    how to clear yours.
  - A "Log out" sidebar button is rendered automatically when `logout` is
    configured, and omitted entirely otherwise — no behavioural change for
    existing users of the option who don't set it.
  - New `logoutRedirectTo` config option (default: `'/'`).
  - The button submits a `POST {basePath}/_logout` form, never a bare link:
    logging out must never be triggerable by a GET (a crawler, a link
    prefetch). This route is checked _before_ `authCheck`, so a user whose
    session already expired can still use it to clean up client-side state
    instead of being stuck behind a 401 with no way back.

## [0.4.0] - 2026-08-09

### Added

- **Editable relations in forms**, Django-admin style:
  - Foreign keys (`to-one`) rendered as a `<select>` with readable labels
    instead of a raw ID field; automatic fallback to a text input beyond a
    configurable threshold or for composite FKs (which can't be represented
    in an `<option>`)
  - Implicit many-to-many relations (Prisma pivot tables) rendered as
    checkboxes, with correct `connect`/`set` writes and protection against
    data loss when a form is submitted with the field unchecked/absent
  - Read-only "Related" block on edit pages, listing inverse relations
    (1-N, 1-1) with direct links to the filtered list and to pre-filled
    creation
  - List filtering via `?filter=field:value`
  - `GET {basePath}/_search` endpoint to query a relation's options as JSON
    (pagination, text search, scoping respected) — groundwork for a future
    client-side search widget
- New per-model config option: `relations` (widget, label, sort order,
  scoping via `where`, threshold for falling back to a text field)
- Systematic server-side validation of relations before any write: ID
  consistency, existence in the database, scoping respected — prevents
  modifying a relation to point at an unauthorized record (IDOR)

### Changed

- The Prisma schema parser now correctly recognizes explicitly named
  relations and inverse relations, including when several relations exist
  between the same two models (avoids silent mismatches)

### Fixed

- A Prisma schema with multiple FKs on the same model (e.g. `author` and
  `reviewer` both pointing at `User`) could previously produce an incorrect
  relation match

## [0.3.0] - 2026-08-06

### Added

- Automatic detection and hiding of pivot tables (implicit many-to-many)
  from the list of administrable models
- Migration of internal views to Svelte components
- Test suite with 100% coverage and continuous integration

### Changed

- Unified API around `createAdminHandler` (single SvelteKit hook)

### Fixed

- Systematic escaping of values coming from the URL and the database in
  the rendered HTML (potential XSS vulnerability)
- ID coercion now consults the primary key's actual type (a fully numeric
  `String` PK is no longer sent to Prisma as an `Int`)
- An invalid `?page=` (`abc`, `0`, negative, out of safe integer range)
  falls back to the first page instead of sending a `NaN` or negative `skip`
- A URL with three or more segments renders a "not found" page instead of
  the dashboard
- Textarea field detection heuristic is now case-insensitive
- An invalid branding color falls back to the default color instead of
  rendering black

### Removed

- **Breaking**: removed the old loader-based API (`createAdmin`,
  `createLayoutLoad`, `createModelListLoad`, etc.) — use
  `createAdminHandler`
- **Breaking**: removed the exported Svelte components
  (`sveltekit-admin/components`) and the `sveltekit-admin/admin` export
- **Breaking**: removed the exported CRUD utilities
  (`createListOperation`, `buildSearchWhere`, `createAuthGuard`, …)
- Removed configuration options that were never implemented
  (`branding.logo`, `models[].icon`)

## [0.2.1] - 2026-08-05

### Fixed

- Minor fixes to the standalone handler introduced in 0.2.0

## [0.2.0] - 2026-08-05

### Added

- Standalone admin handler: no more manual route creation, everything goes
  through a single hook

## [0.1.0] - 2026-08-05

### Added

- First public release of `sveltekit-admin`
