# Changelog

## 0.9.0

### Minor Changes

- 3c6ab31: **An accessibility and responsive baseline for the whole admin.** Seven fixes, each one a thing that was measurably wrong rather than a guideline cited in the abstract.

  **The focus indicator on form fields was effectively invisible.** `.ska-input:focus` set `outline: none` and replaced it with a box-shadow at 10% opacity — roughly 1.1:1 against the white background, where 3:1 is the minimum. It is now a 2px outline in the brand colour, which is itself contrasted, with the shadow only accompanying it. The invalid-field variant gets the same treatment in red.

  **Nothing else had a focus indicator at all.** Buttons, sidebar links, the logo, back links, checkboxes and the logout button now share one `:focus-visible` rule — visible when tabbing, absent on mouse click.

  **The admin was unusable below 900px.** The sidebar was `position: fixed` at 260px with the content offset by the same amount, leaving 115px of usable width on a 375px screen. Below that breakpoint the sidebar returns to the flow, its navigation becomes horizontal, and the form stops being capped at 600px.

  **Motion could not be turned off.** Five `transition: all` rules live in the stylesheet; `prefers-reduced-motion: reduce` now neutralises them.

  **Reaching the content took the whole sidebar.** A "Skip to content" link is now the first focusable element on the page, positioned off-screen until focused — off-screen rather than `display: none`, which would remove it from the tab order and make it pointless.

  **Table headers carry `scope="col"`**, and the sidebar `<nav>` an `aria-label` (there are two navigation landmarks now that the pagination is one).

  **Result and refusal banners are announced.** The delete confirmation is `role="status"` (it should not interrupt), a refused filter or sort is `role="alert"`.

  Field-level error associations were already in place and are unchanged.

- d985be0: **Rows can be selected in the list and deleted together.** Each row carries a checkbox, the header carries a "select all on this page" control, and **Delete selected** removes them in one operation, after a confirmation prompt.

  It is one operation rather than a loop over the existing single delete, and that is the point of the design. A loop that fails on the seventh row because of a foreign-key constraint leaves six rows gone and nothing to undo them with. Here there are two possible outcomes: everything selected is deleted, or nothing is and the list says one of the rows is still referenced.

  **`models[].scope` is composed with the selected ids inside the query**, not checked separately. An out-of-scope id matches nothing and raises nothing, so the result never distinguishes "does not exist" from "belongs to another tenant" — the redirect reports how many rows were actually deleted, and a gap against what was selected can only come from a forged POST, since the UI offers nothing out of scope.

  **A selection larger than 200 ids is refused.** The UI can only tick what it displays, and an `IN (…)` of several thousand entries is a load vector on its own.

  **The audit log gets one `delete` entry per row**, each with its `before` snapshot, read with the same scope as the deletion — the log records exactly the rows that went. Without that, the most destructive operation in the admin would have been the one thing the log stayed silent about.

  `DataAdapter` gains `deleteMany(model, ids, authorizationFilter)`, implemented by both the Prisma and Drizzle adapters. A custom adapter needs to implement it before bulk delete works against it. On the Drizzle side, many-to-many pivot rows are cleared for the rows being deleted **and only those** — composing the scope into the pivot delete instead would have stripped the relations of an out-of-scope row that the parent delete leaves untouched.

  The redirect carries `?deleted=N` for the confirmation banner. That parameter is dropped from every link the list then builds, the way `page` already is: it reports an action, it is not list state, and left alone it would follow you through every filter and page click.

  The checkboxes work without JavaScript; only "select all on this page" needs it.

- 2bb26f2: **List views can be sorted by column.** Every column heading is now a link: `?sort=<column>` orders ascending, clicking the same heading again flips to `&dir=desc`. The sort lives in the URL, so it is bookmarkable, and it composes with the active search, the filters and the page size — only the page number is dropped, since changing the sort means they are no longer the same rows.

  **Only the columns the list actually renders can be sorted.** The name from the URL is looked up in that set and never reaches the query as a key — the same rule the filter operators already follow. A column removed by `models[].hidden`, dropped by the sensitive-name heuristic, or beyond the six-column cap is not in the set, and `?sort=` on it is refused with a neutral message that never says whether the column exists. Sorting can therefore only order values that are already readable on screen; it opens no reading the list did not already offer.

  **Results are always tie-broken by primary key, descending.** A sort on a non-unique column otherwise leaves equal rows in an order the engine is free to change between requests — and a `skip`/`take` window laid over an unstable order shows one row twice and another not at all. Sorting _by_ the primary key does not add a redundant second key.

  Headings carry `aria-sort` (`ascending` / `descending` / `none`) and a visible focus ring, so the sort state is announced rather than conveyed by the arrow alone.

  `DataAdapter.listRecords` takes an optional `orderBy: { field, dir }`. Omitting it keeps the previous behavior exactly — primary key, descending. Both the Prisma and Drizzle adapters implement it, and a custom adapter that ignores the option keeps working, just unsorted.

  One internal extraction worth knowing if you have a fork: the resolution of "which columns does the list display" moved out of `List.svelte` into `resolveListColumns`, so the rendered headings and the sort whitelist are the same set by construction rather than by coincidence. The resulting columns are unchanged.

- 9c36560: **The list view's page size is configurable, and a visitor can change it.** Two new options:

  ```ts
  createAdminHandler({
    adapter,
    perPage: 25, // rows per page, default 20
    pageSizeOptions: [25, 50, 100], // what a visitor can switch to
  });
  ```

  `perPage` replaces the hard-coded 20. `pageSizeOptions` (default `[10, 20, 50, 100]`) renders as links under the pagination; the configured `perPage` is added to them automatically, so the active size always appears there. `pageSizeOptions: []` disables the whole mechanism — no selector, and `?perPage=` has no effect.

  **`?perPage=` is honoured only when the value is one of the offered sizes**, and falls back to the configured size otherwise. That check is the point of the feature rather than an afterthought: without it `?perPage=100000` is an unbounded `take` — a denial of service one query parameter away, and on a large table a request that holds a connection open for as long as it runs. The same reasoning caps `perPage` at 200, checked when the handler is created along with the option list; past that it is an export, not a page.

  Changing the size returns to page one, since they are no longer the same rows. The `_search` endpoint keeps using the configured size and ignores `?perPage=` — it feeds relation pickers, not a browsable list.

  Nothing changes for an app that sets neither option: 20 rows per page, and a size selector offering 10/20/50/100.

- 44de92a: **`models[].defaultSort` sets the order a list view arrives in**, before any `?sort=` in the URL:

  ```ts
  models: {
    User: { defaultSort: { field: 'name' } },           // dir defaults to 'asc'
    Post: { defaultSort: { field: 'title', dir: 'desc' } }
  }
  ```

  Without it, nothing changes: a list still arrives ordered by primary key, descending.

  A `?sort=` in the URL always wins. A `?sort=` naming a column that cannot be sorted is still refused and reported, but the list now falls back to this default rather than to the primary key — a refused parameter should not silently undo a configured order.

  `field` must name a column the list **displays**, and it is checked when the handler is created rather than per request. A column that is hidden, dropped by the sensitive-name heuristic, or beyond the six-column cap would produce a sort that no heading can announce and that a visitor has no way to leave; that is a developer mistake, so it throws at boot like an invalid `listFilter` does, naming the columns that are available. An unknown `dir` throws the same way.

  There is deliberately no automatic "sort by `name` when the model has one". Guessing would reorder every existing list without anyone asking, and the guess would drift from what the view actually renders — the same divergence the shared column resolver exists to prevent.

- b7aef25: **An `enum` column is now edited through a `<select>` instead of a free-text input.** The form rendered every enum field as `<input type="text">`, so setting one meant typing a value from the schema by hand, with a typo answered by whatever the driver said about an invalid enum — a generic "The change could not be saved." that named no field.

  The widget mirrors `RelationSelect` (same markup, same `— aucun —` for a nullable column) with two deliberate differences. A non-nullable column with no value yet renders a disabled placeholder option: without it the browser preselects the first declared value, and a create would write a choice the user never made. And a readonly enum renders `disabled` rather than `readonly`, which `<select>` does not support — the field then leaves the POST entirely, `formDataToPrisma` skips the absent key, and the column is not rewritten.

  **The submitted value is revalidated server-side**, like every FK and m2m target already is: a value outside the declared domain is refused with a `422` and `role: invalid value` on the field, keeping the submitted form intact, instead of reaching the driver. A forged POST does not get to write a value the `<select>` would never have offered.

  Selecting `— aucun —` on a nullable enum writes `null`. It previously would have written `""`, which no enum type declares and every driver rejects. An empty value on a non-nullable enum is refused with `role is required` rather than passed through.

  No config change is required: enum values come from the schema the adapter already introspects, for both the Prisma and Drizzle adapters. `ViewModel` gains an `enums` map, filled by the runtime; a `ViewModel` built by hand without it degrades to the previous text input.

- eb130ca: **An empty form field now means `null` on every column type, and is refused on a column that does not accept `NULL`.**

  `formDataToPrisma` was inconsistent about what "empty" meant: an emptied `Int`, `Float`, `DateTime` or `Json` field became `null`, but an emptied `String` became `""`. That difference was invisible until it wasn't — a `String? @unique` column accepted the first blanked row and rejected the second on a unique violation, and a column blanked from the admin came back as `""` where the rest of the app tested for `null`.

  An emptied `String` (and an emptied enum) now writes `null`, like every other type already did.

  **A column declared non-nullable can no longer be saved empty.** It answers `422` with `<field> is required` attached to the field, keeping the submitted form intact, instead of writing `""` and answering `303` as if it had worked — or, for a numeric column, sending `null` to the driver and coming back with a generic message naming no field. This is the same rule already applied to required sensitive columns on create, now applied to every scalar type.

  Two distinctions the check deliberately preserves:

  - **A field absent from the POST is not an empty field.** A readonly field, a hidden one, or a column with a `@default` that the create form does not render, submits nothing — the key stays out of the payload and the column is not written. Only a key that is _present_ and empty counts as a value the user cleared.
  - **A scope column left empty is still imposed, not refused.** The check runs after `models[].scope` is applied, so a model whose tenant column is required and visible stays creatable from the admin — the create form renders that column empty by design, and treating that as a refusal would make the model impossible to create. Relation scalars are likewise still owned by the FK validation that runs before, so an empty required relation keeps reporting as `author is required` rather than `authorId is required`.

  If your app relies on the admin writing `""` into a required `String` column, that submit is now refused. Make the column nullable, or give it a `@default("")`.

- d96bb48: **A `Bytes` column is no longer rendered in forms**, and a value that cannot be converted to its column's type is refused instead of silently written.

  `Bytes` had no widget of its own, so it fell through to the generic text branch and rendered as `<input type="text">`. That input could never work: the driver expects a `Uint8Array` and was handed a string, so every save on such a column failed. The column is now excluded from create and edit forms, the way list views already excluded it. A model with a required `Bytes` column cannot be created from the admin — that was already true in practice, except the failure now happens before the form instead of after the POST.

  **Unparseable JSON is refused** with a `422` and `metadata: invalid value` on the field, submitted form preserved. It used to be written as `null` without a word, which lost both what was typed and what the row already held, behind a `303` that looked successful. A number field carrying something that is not a number is refused the same way, rather than sending `NaN` to the driver and coming back with a generic message naming no field.

  Foreign-key scalars keep their own error: an unparseable id still reports as `author: invalid id` on the relation, not `authorId: invalid value` on the scalar.

  `formDataToPrisma` now returns `{ data, invalid }` instead of the payload alone. It is not exported from the package, so this is internal only.

  The **Field Types** documentation page is rewritten around this: what each type renders as (including the enum `<select>` added in the previous release), what an empty field writes, which types are not editable, and the two precision limits that never raise an error — `BigInt` goes through `parseInt` so values above `2^53 - 1` lose precision, and `Decimal` goes through `parseFloat`. It also corrected a stale claim that edit forms still render sensitive fields normally; they have not since sensitive columns were closed off on the write path.

- 818cb38: **The list view's pagination is now a real page navigation** instead of a lone Previous/Next pair. It renders a window of page numbers around the current page, always keeping the first and last page reachable in one click:

  ```
  « Previous 1 … 8 9 [10] 11 12 … 20 Next »
  ```

  On a table of a few thousand rows, reaching the end previously meant clicking Next until you got there.

  The window collapses to whatever fits: fewer pages than the window renders them all, and an ellipsis that would hide exactly one page renders that page instead — a gap saves no space there and costs a click.

  Accessibility: the controls sit in a `<nav aria-label="Pagination">`, the current page is marked `aria-current="page"` and is deliberately not a link (a link to where you already are is a keyboard trap as much as it is noise), and the ellipsis is `aria-hidden`. The first/last controls carry `aria-label` so `«` and `»` are announced as something other than punctuation.

  Page links go through the same URL builder as the rest of the list view, so the active search, filters and sort are preserved. The counter (`Showing 21 to 40 of 400`) is unchanged.

- bb907e8: A create or update refused by the admin no longer discards what was typed. The form is re-rendered with the submitted values instead of an empty create form, or of the record as it still stands in the database, and the failure is attached to the field it names rather than only to the page banner.

  The values come from the raw `FormData`, not from the coerced `formDataToPrisma` payload: `abc` typed into an `Int` field coerces to `null`, and rendering that back would erase the entry and hide the mistake. An unchecked checkbox stays unchecked — a browser omits the key entirely, so falling back to the stored row would silently re-enable a `Boolean` the user had just turned off. Many-to-many works the same way: the checked ids come from the submitted `__rel__<field>` values, and the `__rel_present__<field>` sentinel is what separates "everything unchecked" from "the widget was not in the form". A readonly field keeps its database value instead — a browser does submit a `readonly` input, but nothing requires it to, and blanking the id and the timestamps because a request omitted them is not data anyone entered.

  A field listed in `models[].hidden` or matched by `isSensitiveFieldName` is never echoed back into the HTML. That reuses the repository's shared predicate rather than adding a second heuristic, and it means a password has to be retyped after a refused submit — the same trade-off Django makes with `PasswordInput(render_value=False)`.

  When the error names a field, that widget now carries `aria-invalid="true"` and an `aria-describedby` pointing at the message rendered next to it. A relation is reached by either name, so a `models[].scope` refusal on `organizationId` and a foreign-key refusal on `organization` both land on the same select. A `<fieldset>` of many-to-many checkboxes gets `aria-describedby` only, since `aria-invalid` is not permitted on its implicit `group` role. An error that names no field — a unique conflict, or the generic message — keeps rendering in the page banner exactly as before; the unique-constraint field is not guessed from driver metadata, because that classification is by code only. No error message text changes.

  A refused form is now served with `422` instead of `200`. The request was well-formed and its content rejected, and a `200` made a failed write indistinguishable from a successful one for anything that reads the status without parsing the HTML. Successful writes still redirect with `303`, an `AdminConfigError` from a misconfigured `scope` still replaces the page as before, and the shared error path that covers failed list reads and plugin pages still renders with `200`.

- cc880e8: A `String` field whose name matches `isSensitiveFieldName` (`password`, `passwordHash`, `apiToken`, `clientSecret`…) is no longer treated as an ordinary text column by the form and the write path.

  **The edit form no longer renders it at all.** It used to render the stored value into the HTML, so any user's password hash was readable from view-source, the devtools, a screenshot or a screen share by anyone allowed to _edit_ that record — a weaker permission than being allowed to _read_ the credential. `models[].hidden` and `isSensitiveFieldName` already closed list display, `?q=` search, `?f.*=` filters and the audit payload; the form was the one path left open.

  **An update never writes the column.** It previously rewrote it on every save, which only appeared harmless because the rendered value round-tripped back. With the field gone from the form, a value arriving in a POST did not come from the UI, so it is dropped rather than written — no error, since this is data that was not asked for rather than data that was refused. Editing a record's name no longer touches its credential.

  **A create still offers the field**, because nothing is stored yet to leak and removing it would make a model with a required sensitive column impossible to create from the admin. What changes there: an empty value on a required column is now refused with a `422` and `password is required` on the field, instead of silently writing `""` and answering `303` as if it had worked — which produced an account with an unusable credential. An empty value on an _optional_ column omits the key rather than writing `""`, since `""` is indistinguishable from a secret that genuinely is the empty string.

  The type filter matters: the rule applies to `String` columns only. `isSensitiveFieldName` matches by substring, so without it an `Int` named `tokenCount` or `hashtagCount` would have become uneditable in the admin. It stays visible and editable.

  This also closes a hole opened by the submitted-value work shipping in this same release: a refused update re-rendered the sensitive field empty (correctly), and the next save then wrote `""` over the hash. Preserving the value across a refused submit had only ever worked by accident, through the round-trip of the value that should not have been rendered in the first place.

  Note for anyone who used the admin to set passwords: the value is written to the column verbatim, with no hashing — it always was. There is no transform hook yet, so a create form that sets a password stores plaintext. Put the field in `models[].hidden` and manage credentials in your own app until a write-transform hook exists.

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
