# AGENTS.md

For a deep tour of the codebase (architecture, request flow, security invariants,
release process), read `CLAUDE.md` — it is the authoritative guide. The commands
for the library live in `package.json` and are described in `CLAUDE.md`; don't
duplicate them, reference those.

## Cursor Cloud specific instructions

### Environment

- Node 22 and pnpm 10.25.0 are preinstalled. This is a pnpm workspace whose members
  are `.` (the `sveltekit-admin` library) and `example` (see `pnpm-workspace.yaml`);
  a single root `pnpm install` covers both.
- The startup update script runs `pnpm install --frozen-lockfile` and `pnpm run test:gen`.
  `test:gen` generates a Prisma client into `tests/fixtures/prisma/client/` (gitignored).
  `pnpm run check`, `pnpm run lint`, and the `test*` scripts all need that client to exist,
  so if it goes missing, re-run `pnpm run test:gen`.

### Verifying the library (primary product)

- Standard commands are in `package.json`/`CLAUDE.md`: `pnpm run check`, `pnpm run lint`,
  `pnpm run test` (or `test:coverage`), `pnpm run package`.
- `pnpm run lint` reports many `@typescript-eslint/no-explicit-any` **warnings** — these are
  intentional (see `eslint.config.js`) and CI only fails on errors; a clean run is "0 errors".
- `vitest.config.ts` enforces 100% coverage on `src/lib/**`; a new branch needs a real test,
  not a suppression.

### Running a live admin UI (the `example/` app)

- `pnpm run dev` at the repo root only serves a "Dev only" placeholder page (`src/routes/`);
  it does **not** wire up the admin panel. To exercise the real admin UI, run the `example/`
  app instead.
- One-time DB setup for the example (SQLite `example/prisma/dev.db`, all gitignored):
  run, from `example/`, `pnpm exec prisma generate --schema prisma/schema.prisma`,
  then `pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate`,
  then `pnpm run db:seed`. Then start it with `pnpm dev` (from `example/`, serves on `:5173`).
- Non-obvious auth gotcha: `example/src/hooks.server.ts` sets
  `authCheck: (event) => event.locals.user?.role === 'admin'` but the example ships **no**
  handler that populates `event.locals.user`, so `/admin` returns **401** out of the box.
  To actually view/use the admin UI, prepend a handler (via `sequence`) that sets
  `event.locals.user = { role: 'admin', ... }`. Treat that as a temporary local-only edit;
  don't commit it.
- When the example dev server first boots, Vite's dependency scanner may print a
  `Failed to resolve entry for package "@prisma/client"` error. It is non-fatal — the server
  still starts and serves requests (`/` → 200, `/admin` → 200 once auth is provided).

### Unrelated sub-project

- `docs/` is a separate, independent SvelteKit project with its own lockfile and deps that the
  root workspace does **not** install. `pnpm run check` prints a harmless warning about
  `docs/vite.config.ts` / a missing `@tailwindcss/vite`; ignore it — library type-checking
  still reports 0 errors.
