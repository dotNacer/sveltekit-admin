---
"sveltekit-admin": minor
---

**List views can be sorted by column.** Every column heading is now a link: `?sort=<column>` orders ascending, clicking the same heading again flips to `&dir=desc`. The sort lives in the URL, so it is bookmarkable, and it composes with the active search, the filters and the page size — only the page number is dropped, since changing the sort means they are no longer the same rows.

**Only the columns the list actually renders can be sorted.** The name from the URL is looked up in that set and never reaches the query as a key — the same rule the filter operators already follow. A column removed by `models[].hidden`, dropped by the sensitive-name heuristic, or beyond the six-column cap is not in the set, and `?sort=` on it is refused with a neutral message that never says whether the column exists. Sorting can therefore only order values that are already readable on screen; it opens no reading the list did not already offer.

**Results are always tie-broken by primary key, descending.** A sort on a non-unique column otherwise leaves equal rows in an order the engine is free to change between requests — and a `skip`/`take` window laid over an unstable order shows one row twice and another not at all. Sorting *by* the primary key does not add a redundant second key.

Headings carry `aria-sort` (`ascending` / `descending` / `none`) and a visible focus ring, so the sort state is announced rather than conveyed by the arrow alone.

`DataAdapter.listRecords` takes an optional `orderBy: { field, dir }`. Omitting it keeps the previous behavior exactly — primary key, descending. Both the Prisma and Drizzle adapters implement it, and a custom adapter that ignores the option keeps working, just unsorted.

One internal extraction worth knowing if you have a fork: the resolution of "which columns does the list display" moved out of `List.svelte` into `resolveListColumns`, so the rendered headings and the sort whitelist are the same set by construction rather than by coincidence. The resulting columns are unchanged.
