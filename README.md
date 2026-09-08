# sveltekit-admin

🎛️ A zero-route Django-like admin panel for SvelteKit applications.

[![npm](https://img.shields.io/npm/v/sveltekit-admin)](https://www.npmjs.com/package/sveltekit-admin)
[![License](https://img.shields.io/npm/l/sveltekit-admin)](./LICENSE)

> **Canonical documentation:** [Installation & Quick Start](https://github.com/dotNacer/sveltekit-admin/tree/main/docs) contains the Prisma and Drizzle setup guides, security model, configuration reference, and troubleshooting.

## At a glance

- Generated dashboard, lists, forms, relations, search, filters, and CRUD
- A single SvelteKit `handle` hook — no generated route files
- Prisma shortcut plus a dedicated `sveltekit-admin/adapters/drizzle` export
- `authCheck`, CSRF Origin verification, tenant `scope`, hidden fields, and optional audit callbacks
- Plugins for extra server-rendered pages and record actions

## Quick start (Prisma)

```bash
pnpm add sveltekit-admin @prisma/client
pnpm add -D prisma
pnpm exec prisma generate
```

```ts
// src/hooks.server.ts
import { createAdminHandler } from 'sveltekit-admin';
import { prisma } from '$lib/server/prisma';

export const handle = createAdminHandler({
  prisma,
  authCheck: (event) => event.locals.session?.user?.role === 'admin'
});
```

Open `/admin`. The default schema path is `./prisma/schema.prisma`; set `prismaSchemaPath` when it lives elsewhere. There are no admin routes to create.

## Drizzle

Drizzle users should import both symbols from the dedicated subpath:

```ts
import { createAdminHandler, createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';

export const handle = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: (event) => event.locals.session?.user?.role === 'admin'
});
```

The schema object contains your exported tables and relations. Drizzle model names in `models` are export keys such as `users`, not Prisma model names.

## Security essentials

Set `authCheck` before deployment. Use `models[].scope` for tenant authorization; `listWhere` is list-only and does not protect direct detail or mutation URLs. Keep CSRF enabled unless an equivalent boundary is deliberately provided. Fields matching `password`, `hash`, `secret`, or `token`, and fields in `hidden`, are kept out of sensitive views and callback payloads.

Use `models[].transform` to turn a raw submitted value into what actually gets written — the classic case is hashing a password before it reaches the database, since a store like bcrypt/argon2/better-auth will never accept plain text:

```ts
import { hash } from '@node-rs/argon2';

createAdminHandler({
  prisma,
  models: {
    User: {
      transform: { password: async (raw) => await hash(String(raw)) }
    }
  }
});
```

The transform runs inside the same request-scoped write path as the rest of validation (before the actual insert/update), so `async` is fully supported. A field is only transformed when it is actually present in the submitted payload — nothing runs for a readonly/hidden/empty-optional field. A transform can never run on a `scope` (tenant) column: that value is imposed by the server, not a user submission. If the transform throws, the write is rejected as a normal validation error naming the field — never a raw driver error.

## Development

```bash
pnpm install
pnpm run check
pnpm run lint
pnpm run test
```

For the documentation site:

```bash
cd docs
pnpm run check
pnpm run lint
pnpm run build
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for release and contribution conventions, and [`CHANGELOG.md`](./CHANGELOG.md) for history.
