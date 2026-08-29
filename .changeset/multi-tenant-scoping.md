---
"sveltekit-admin": minor
---

Add model-level `scope(ctx)` tenant isolation across reads, mutations, relation options, search, dashboard counts, and plugin access. Scoped creates force equality scope fields and fail closed when the tenant context is missing or ambiguous.
