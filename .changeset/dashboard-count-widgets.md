---
"sveltekit-admin": minor
---

**Filtered counters on the dashboard.** A `count` widget shows how many rows match a filter and links to the list already filtered the same way:

```ts
{ type: 'count', model: 'Order', label: 'Pending', query: 'f.status=PENDING&f.total__gte=100' }
```

`query` is the list view's own query string. That is the whole design: a counter cannot express anything the list cannot show, it inherits the operator whitelist and the sensitive-field exclusion rather than reimplementing them, and the card links to a list whose total is the number on the card. A typo, a `page=` parameter, or a filter on a hidden or sensitive field is refused when the handler is created — not silently ignored at render time.

**Behaviour change — dashboard counts now compose `listWhere` as well as `scope`.** A model card could previously announce 40 rows while the list it links to, scoped by `listWhere`, showed 12. The number was already wrong; a counter that links to its own filtered list makes it visibly wrong. The composition is strictly more restrictive, so nothing becomes visible that was not before, but **a dashboard count can now be lower than it was** if you use `listWhere`. If you meant that scope to apply everywhere, `scope` is the hook that does it.
