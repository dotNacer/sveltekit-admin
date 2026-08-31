---
"sveltekit-admin": minor
---

**`models[].defaultSort` sets the order a list view arrives in**, before any `?sort=` in the URL:

```ts
models: {
  User: { defaultSort: { field: 'name' } },           // dir defaults to 'asc'
  Post: { defaultSort: { field: 'title', dir: 'desc' } }
}
```

Without it, nothing changes: a list still arrives ordered by primary key, descending.

A `?sort=` in the URL always wins. A `?sort=` naming a column that cannot be sorted is still refused and reported, but the list now falls back to this default rather than to the primary key — a refused parameter should not silently undo a configured order.

`field` must name a column the list **displays**, and it is checked when the handler is created rather than per request. A column that is hidden, dropped by the sensitive-name heuristic, or beyond the six-column cap would produce a sort that no heading can announce and that a visitor has no way to leave; that is a developer mistake, so it throws at boot like an invalid `listFilter` does, naming the columns that are available. An unknown `dir` throws the same way.

There is deliberately no automatic "sort by `name` when the model has one". Guessing would reorder every existing list without anyone asking, and the guess would drift from what the view actually renders — the same divergence the shared column resolver exists to prevent.
