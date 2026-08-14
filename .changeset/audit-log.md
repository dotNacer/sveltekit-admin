---
"sveltekit-admin": minor
---

Add an optional **`audit`** callback on `createAdminHandler`. After a successful create, update, or delete it receives a redacted `AuditEvent` (`action`, `model`, `id`, `values` / `before` / `after` / `changes`, plus the SvelteKit `event` so the actor can be read from `locals`). Sensitive and `hidden` fields are stripped. If the callback throws, the mutation still redirects (the error is logged). No callback means no behavior change.
