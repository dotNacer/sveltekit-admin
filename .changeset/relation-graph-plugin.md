---
'sveltekit-admin': minor
---

feat: **`relationGraphPlugin` adds a record dependency-graph page**, exported at `sveltekit-admin/plugins/relation-graph` and passed through the existing `plugins` array. `models` picks which models get the Graph link, `depth` the hops (default 2). A handler without `plugins` is unchanged.
