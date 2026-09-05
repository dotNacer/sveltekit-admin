---
'sveltekit-admin': minor
---

feat: **A `recent` widget lists a model's latest rows, each linking to its edit page.** Without `sort` it follows the model's `defaultSort`, then primary key descending. Reads compose `scope` and `listWhere`, and each row is redacted before its label is picked.
