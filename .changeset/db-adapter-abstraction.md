---
"sveltekit-admin": minor
---

Extract a generic `SchemaIntrospector`/`DataAdapter` abstraction behind Prisma, exposed as `createPrismaAdapter`. `createAdminHandler({ prisma, prismaSchemaPath })` keeps working exactly as before; `createAdminHandler({ adapter })` is now also available for anyone building a custom or future non-Prisma adapter.
