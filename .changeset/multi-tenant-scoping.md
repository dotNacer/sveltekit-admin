---
"sveltekit-admin": minor
---

Add model-level `scope(ctx)` tenant isolation across reads, mutations, relation options, search, dashboard counts, and plugin access. Scoped creates force equality scope fields and fail closed when the tenant context is missing or ambiguous. The forced values are re-applied after foreign-key revalidation, which matters when the tenant column is itself a relation scalar such as `organizationId` — the common case. A submitted value that survives that far and still conflicts — which is what a relation scalar does — is rejected rather than written, since the value is server-determined.

Relation targets submitted by a POST are re-checked inside the write transaction. On PostgreSQL that check now takes a `FOR SHARE` row lock, because `SERIALIZABLE` alone does not prevent a concurrent transaction from moving the target out of scope between the check and the write — PostgreSQL's SSI finds no dependency cycle in that sequence and lets both transactions commit. MySQL is unaffected: `SERIALIZABLE` already turns those reads into locking reads there, and `FOR SHARE` is 8.0-only syntax. Guards are locked in a deterministic `(model, primary key)` order, so two concurrent requests submitting the same relation ids in a different order cannot deadlock each other.

The Drizzle `deleteRecord` no longer issues a verification `SELECT` before deleting: the scoped `DELETE` is itself the guard, and a zero-row result rolls the pivot deletions back. This removes the window between the check and the delete.
