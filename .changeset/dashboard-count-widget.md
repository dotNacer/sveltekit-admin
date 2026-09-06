---
'sveltekit-admin': minor
---

feat: **A `count` widget shows how many rows match a filter and links to the list filtered the same way.** Its `query` is the list view's own query string, so it inherits the operator whitelist and the sensitive-field exclusion; a bad filter is refused at boot, not ignored at render.
