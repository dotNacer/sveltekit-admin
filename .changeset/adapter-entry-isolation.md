---
"sveltekit-admin": minor
---

Re-export `createAdminHandler` and `defaultAdminCheck` from `sveltekit-admin/adapters/drizzle`, so a Drizzle-only app can import the handler and `createDrizzleAdapter` from one subpath without evaluating the Prisma adapter modules. `createAdminHandler({ prisma })` from `sveltekit-admin` is unchanged; importing the handler from the root entry plus the Drizzle adapter from the subpath still works, but that path keeps loading the Prisma adapter JavaScript.
