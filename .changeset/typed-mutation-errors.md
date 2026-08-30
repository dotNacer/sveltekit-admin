---
"sveltekit-admin": patch
---

A failed create or update no longer renders the database driver's own error message. Prisma's `P2002` used to reach the browser as ``Invalid `prisma.user.create()` invocation … Unique constraint failed on the fields: (`email`)``, query text included; unique, foreign-key and missing-row failures are now recognized by driver code (Prisma, PostgreSQL, MySQL, SQLite) and rendered as a fixed library message, with anything unrecognized logged server-side and shown as a generic one.

Validation refusals raised by the admin itself are unchanged, word for word — an invalid relation target still reads `author: invalid value`. Internally they carry a kind and a field instead of being recognized by substring matching on their own message, which is what made the leak possible to fix without touching them. Plugin pages and failed list reads keep rendering exactly as before.

A `models[].scope` misconfiguration (missing tenant value, non-equality condition, an empty scope object) still throws its own developer-facing `AdminConfigError` message unchanged — that path is deliberately exempt from the new masking, since it's meant for the integrator, not the admin user.
