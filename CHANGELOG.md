# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
    prefetch). This route is checked *before* `authCheck`, so a user whose
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
