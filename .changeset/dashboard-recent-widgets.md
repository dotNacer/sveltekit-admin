---
"sveltekit-admin": minor
---

**Recent-record panels on the dashboard.** A `recent` widget lists the latest rows of a model, each linking to its edit page:

```ts
{ type: 'recent', model: 'Order', title: 'Latest Orders', limit: 5, sort: 'createdAt', dir: 'desc' }
```

Without `sort`, rows follow the model's configured `defaultSort` when it has one, and primary-key descending otherwise — the same precedence `findMany` already uses elsewhere. The read composes `scope` and `listWhere` exactly like every other dashboard widget, so a tenant-scoped model never leaks another tenant's rows into the panel.

Each row's label is resolved from the same candidate fields (`name`, `title`, `label`, `email`, `username`, `slug`) used everywhere else in the admin — but only after the row is stripped of every field in `models[].hidden` and every sensitive field name (`password`, `hash`, `secret`, `token`, …). That redaction runs *before* the label is picked, so a hidden or sensitive column can never become the visible text of a panel entry; only the label and the record's id (already public in the list URL) ever reach the rendered HTML. A model with no matching rows yet renders an empty panel, not an error.
