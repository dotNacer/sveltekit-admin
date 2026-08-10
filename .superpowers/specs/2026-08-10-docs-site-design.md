# sveltekit-admin Documentation Site — Design

## Context

`sveltekit-admin` currently documents itself through a single `README.md`, an
internal `ARCHITECTURE.md`, and two design notes (`docs/design/list-search-filters.md`,
`docs/design/relations.md`). We want a real documentation site, built by copying
and configuring `motion-core-docs-template` (a SvelteKit + mdsvex docs template
with configurable navigation, SEO, and a package-manager-aware install snippet
component) directly into this repository.

The existing `docs/` folder holds this repo's own spec-driven-development
artifacts (`docs/design/*.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`).
The user has explicitly decided to delete that content and repurpose `docs/`
for the new documentation site (confirmed destructive action — content is
tracked in git and recoverable from history if ever needed). This design spec
is therefore kept at `.superpowers/specs/` at the repo root, not under `docs/`,
since `docs/` itself is the thing being wiped and rebuilt.

## Goals

- A locally runnable documentation site for `sveltekit-admin`, living at
  `sveltekit-admin/docs/`.
- Full README + architecture content, restructured into multiple pages, plus
  the two existing design notes as advanced/reference pages.
- Matches this repo's tooling conventions (bun, not pnpm).
- No deploy target decided yet — keep the adapter generic.

## Non-goals

- Choosing a hosting/deploy target (Cloudflare, Vercel, static, etc.) — left
  for later, hence `adapter-auto`.
- Real brand/logo art — placeholder logo carried over from the template,
  swapped later.
- Search integration beyond what the template already provides out of the box.

## 1. Location & tooling

- Copy `motion-core-docs-template/apps/web/*` into `sveltekit-admin/docs/` as a
  **flat, standalone SvelteKit app** — no pnpm workspace wrapper, no nested
  `apps/web`.
- Delete the current contents of `sveltekit-admin/docs/` first
  (`docs/design/`, `docs/superpowers/`) since the user has confirmed this.
- Switch tooling to bun to match the rest of the repo:
  - `bun install`, `bun run dev`, `bun run build`, `bun run check`, `bun run lint`, `bun run format`.
  - Package name: `sveltekit-admin-docs`, `"private": true`.
- Drop Cloudflare-specific pieces from the copied template:
  - Remove `wrangler.jsonc`.
  - Remove `@sveltejs/adapter-cloudflare` dependency and `wrangler` dependency.
  - Replace with `@sveltejs/adapter-auto` in `svelte.config.ts`.
  - Remove `deploy`, `preview:cf`, `preview:cf:remote`, `cf-typegen` scripts.
- Drop the demo "Examples" content section and its files
  (`src/lib/content/examples/**`) and its entry in `navigation.ts`.
- Changelog generation: copy `scripts/generate-changelog-docs.mjs` into
  `docs/scripts/generate-changelog-docs.mjs`. Update its paths so:
  - `sourcePath` = `sveltekit-admin/CHANGELOG.md` (one level above `docs/`).
  - `targetPath` = `docs/src/lib/content/docs/changelog.svx`.
  - Wire it into `predev`/`prebuild` scripts as the template does
    (`bun run docs:changelog`).

## 2. Content & navigation

Single `docs` content section (the template's second "examples" section is
removed). Sidebar navigation (`src/lib/config/navigation.ts`):

- **Getting Started**
  - Introduction (`""` slug, index) — vision/tagline, feature list, requirements
    (SvelteKit 2.x, Prisma 5.x/6.x), from README intro + `ARCHITECTURE.md` vision.
  - Installation & Quick Start (`installation`) — install commands (npm/bun/pnpm
    via `InstallationTabs`), the 3-line `hooks.server.ts` setup, what you get at
    `/admin`.
- **Configuration**
  - Configuration Reference (`configuration`) — full `createAdminHandler` options
    table: `prisma`, `prismaSchemaPath`, `basePath`, `authCheck`, `models`,
    `exclude`, `branding`.
  - Model Configuration (`model-configuration`) — `hidden`, `readonly`,
    `listFields`, `label` per-model options with examples.
  - Field Types (`field-types`) — the Prisma-type → form-input mapping table,
    plus the auto-hide-sensitive-fields heuristic (substring match on
    password/hash/secret/token, list-view-only, override via `listFields`).
  - Authentication (`authentication`) — `authCheck` option, and the
    `sequence(authHandle, adminHandle)` pattern for combining with an existing
    auth handler.
- **Advanced**
  - How It Works (`how-it-works`) — request interception model, routes handled
    (`/admin`, `/admin/[model]`, `/admin/[model]/new`, `/admin/[model]/[id]`),
    schema introspection pipeline, drawn from README "How It Works" + package
    structure from `ARCHITECTURE.md`.
  - Search & Filters (`search-filters`) — adapted from
    `docs/design/list-search-filters.md`.
  - Relations (`relations`) — adapted from `docs/design/relations.md`.
- **Changelog**
  - Changelog (`changelog`) — auto-generated from `CHANGELOG.md`, same mechanism
    as the template.

Content authored as `.svx` files under `docs/src/lib/content/docs/`, using the
template's existing mdsvex components (`Steps`/`Step`, tables, `InstallationTabs`,
`ComponentPreview` where relevant for showing config snippets).

## 3. Branding & site config

`src/lib/config/site.ts`:

- `name` / `shortName`: `sveltekit-admin`
- `description`: from `package.json` (`"Django-like admin panel for SvelteKit + Prisma"`, expanded slightly for SEO)
- `author`: `dotNacer`
- `keywords`: from `package.json` keywords (`svelte`, `sveltekit`, `admin`, `prisma`, `crud`, `dashboard`, `admin-panel`)
- `links.github`: `https://github.com/dotNacer/sveltekit-admin`
- `package.name`: `sveltekit-admin`
- `url`: placeholder `https://sveltekit-admin.dev` (no real domain yet — trivial to change later)

`src/lib/config/branding.ts`:

- `name`: `sveltekit-admin`
- `logoRaw`: carry over the template's placeholder SVG mark as-is; swap for real
  brand art later (explicitly out of scope now).

`src/lib/config/content-ui.ts`: keep template defaults (search, TOC, page
actions, pagination, package manager tabs) — no changes needed since these are
already generic.

## Testing / verification

- `bun run check` (svelte-check) passes in `docs/`.
- `bun run build` succeeds.
- `bun run dev` serves the site locally; manually spot-check each new page
  renders, sidebar navigation/categories match the plan above, and the
  changelog page reflects `CHANGELOG.md`.
- No automated tests planned for static content pages themselves (this is a
  docs site, not application logic).
