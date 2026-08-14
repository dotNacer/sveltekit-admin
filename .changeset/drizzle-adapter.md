---
"sveltekit-admin": minor
---

Add a **Drizzle** adapter, imported from `sveltekit-admin/adapters/drizzle` as `createDrizzleAdapter({ db, schema })`, with list/form/dashboard, relations, m2m, filters, and flat `listWhere` parity. `createAdminHandler({ prisma })` is unchanged; `@prisma/client` and `drizzle-orm` are optional peer dependencies so a Drizzle-only app no longer needs Prisma, and a Prisma-only app never has to install `drizzle-orm`.
