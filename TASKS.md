# Development Tasks

This file is a lightweight status board for repository work. Historical design
specifications and implementation plans live under `docs/superpowers/` and are
not a current backlog.

## Delivered

- Prisma schema introspection and generated CRUD admin views.
- Zero-route SvelteKit `handle` integration.
- Pagination, configurable page sizes, free-text search and list filters.
- Stable column sorting and per-model `defaultSort`.
- Prisma and Drizzle adapters, including relations and many-to-many writes.
- Model-level tenant scoping with fail-closed reads and mutations.
- CSRF Origin verification for state-changing admin requests.
- Sensitive-field redaction across views, search, filters, audit events and plugins.
- Authentication gate, optional logout callback and audit callback.
- Plugin pages, list-row actions and edit-screen actions.
- Enum form controls, actionable mutation errors, bulk delete and responsive UI.
- Packed-consumer smoke test and automated Changesets release workflow.

## Current maintenance checklist

- Keep the public documentation in `README.md` and `docs/src/lib/content/docs/`
  synchronized with exported types and runtime behavior.
- Add or update tests for every new branch; the coverage gate is 100% for
  `src/lib/**`.
- Run `pnpm run check`, `pnpm run lint`, `pnpm run test:coverage`,
  `pnpm run package` and `pnpm run smoke:packaged` before merging changes that
  affect the package.
- Add a Changeset to every PR. Use an empty Changeset for docs, test, CI or
  tooling-only changes, as described in `CONTRIBUTING.md`.
- Keep Prisma and Drizzle adapter behavior aligned when changing shared handler,
  query or relation behavior.

## Release process

Do not edit versions or publish manually during normal development. Merge a PR
to `main`; the release workflow creates or updates the Version Packages PR.
Merging that PR updates `package.json` and `CHANGELOG.md`, creates the tag and
publishes to npm.
