---
"sveltekit-admin": minor
---

**The dashboard offers a create action per model.** Each card carries a "+ New" link to the create form, next to the "Manage →" link, which stays expanded to the whole surface of the card. Creating a record no longer requires going through the list first.

The card is no longer an `<a>`: two links cannot be nested inside one another without breaking keyboard navigation and screen-reader announcement. It is now an `<article>` whose "Manage →" link is expanded with an overlay, with a distinct accessible name for each link ("New Users" rather than a second, anonymous "+ New").

Along the way, the page gains a header and delimited sections, laying the groundwork for the configurable dashboard. No extra request is issued.
