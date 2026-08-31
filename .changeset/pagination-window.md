---
"sveltekit-admin": minor
---

**The list view's pagination is now a real page navigation** instead of a lone Previous/Next pair. It renders a window of page numbers around the current page, always keeping the first and last page reachable in one click:

```
« Previous 1 … 8 9 [10] 11 12 … 20 Next »
```

On a table of a few thousand rows, reaching the end previously meant clicking Next until you got there.

The window collapses to whatever fits: fewer pages than the window renders them all, and an ellipsis that would hide exactly one page renders that page instead — a gap saves no space there and costs a click.

Accessibility: the controls sit in a `<nav aria-label="Pagination">`, the current page is marked `aria-current="page"` and is deliberately not a link (a link to where you already are is a keyboard trap as much as it is noise), and the ellipsis is `aria-hidden`. The first/last controls carry `aria-label` so `«` and `»` are announced as something other than punctuation.

Page links go through the same URL builder as the rest of the list view, so the active search, filters and sort are preserved. The counter (`Showing 21 to 40 of 400`) is unchanged.
