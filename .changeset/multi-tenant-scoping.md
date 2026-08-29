---
"sveltekit-admin": minor
---

Add model-level `scope(ctx)` tenant isolation across reads, mutations, relation options, search, dashboard counts, and plugin access. Scoped creates force equality scope fields and fail closed when the tenant context is missing or ambiguous. The forced values are re-applied after foreign-key revalidation, which matters when the tenant column is itself a relation scalar such as `organizationId` — the common case. A submitted value that conflicts with the scope is rejected rather than written, for every scope column: the value is server-determined, so a mismatch is either a forged POST or a form offering a choice it should not offer, and silently correcting it would hide both. A scope column absent from the form is simply set.

Relation targets submitted by a POST are re-checked inside the write transaction. On PostgreSQL that check now takes a `FOR SHARE` row lock, because `SERIALIZABLE` alone does not prevent a concurrent transaction from moving the target out of scope between the check and the write — PostgreSQL's SSI finds no dependency cycle in that sequence and lets both transactions commit. MySQL is unaffected: `SERIALIZABLE` already turns those reads into locking reads there, and `FOR SHARE` is 8.0-only syntax. Guards are locked in a deterministic `(model, primary key)` order, so two concurrent requests submitting the same relation ids in a different order cannot deadlock each other.

The Drizzle `deleteRecord` no longer issues a verification `SELECT` before deleting: the scoped `DELETE` is itself the guard, and a zero-row result rolls the pivot deletions back. This removes the window between the check and the delete.

Transactional writes are retried on a serialization failure or deadlock (PostgreSQL `40001`/`40P01`, MySQL `ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT`), up to three attempts. Those engine errors mean the transaction was rolled back whole and wrote nothing, so replaying it is safe and avoids surfacing a transient conflict as a 500. Nothing else is retried — an authorization refusal is not transient, and replaying it would only repeat the same refusal.
