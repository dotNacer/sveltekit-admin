---
"sveltekit-admin": patch
---

Extract an internal `AdminRuntime` and a pattern-based route table from `createAdminHandler`, and add empty Layout/Form/List slots for a future plugin API. `createAdminHandler({ prisma })` and `{ adapter }` are unchanged; no new exports or config fields.
