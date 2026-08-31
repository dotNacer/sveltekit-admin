---
"sveltekit-admin": minor
---

**The list view's page size is configurable, and a visitor can change it.** Two new options:

```ts
createAdminHandler({
  adapter,
  perPage: 25,                    // rows per page, default 20
  pageSizeOptions: [25, 50, 100]  // what a visitor can switch to
})
```

`perPage` replaces the hard-coded 20. `pageSizeOptions` (default `[10, 20, 50, 100]`) renders as links under the pagination; the configured `perPage` is added to them automatically, so the active size always appears there. `pageSizeOptions: []` disables the whole mechanism — no selector, and `?perPage=` has no effect.

**`?perPage=` is honoured only when the value is one of the offered sizes**, and falls back to the configured size otherwise. That check is the point of the feature rather than an afterthought: without it `?perPage=100000` is an unbounded `take` — a denial of service one query parameter away, and on a large table a request that holds a connection open for as long as it runs. The same reasoning caps `perPage` at 200, checked when the handler is created along with the option list; past that it is an export, not a page.

Changing the size returns to page one, since they are no longer the same rows. The `_search` endpoint keeps using the configured size and ignores `?perPage=` — it feeds relation pickers, not a browsable list.

Nothing changes for an app that sets neither option: 20 rows per page, and a size selector offering 10/20/50/100.
