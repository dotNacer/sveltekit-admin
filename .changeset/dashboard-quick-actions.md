---
'sveltekit-admin': minor
---

feat: **Each dashboard card carries a "+ New" link to the create form**, alongside "Manage →". The card is an `<article>` with an overlay link instead of a nested `<a>`, so keyboard navigation and screen readers get one accessible name per link. No extra request is issued.
