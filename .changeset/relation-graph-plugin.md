---
"sveltekit-admin": minor
---

Add **`relationGraphPlugin`**, a first-party record dependency-graph page exported at `sveltekit-admin/plugins/relation-graph`. Pass it through the existing `plugins` array (`relationGraphPlugin({ models, depth })`); `createAdminHandler({ prisma })` without `plugins` is unchanged. The core `AdminPlugin` contract is not extended.
