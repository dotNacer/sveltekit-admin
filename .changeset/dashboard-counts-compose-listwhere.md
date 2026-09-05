---
'sveltekit-admin': patch
---

fix: Dashboard counts now compose `listWhere` as well as `scope`. A card could announce 40 rows while the list it linked to showed 12. Nothing becomes visible that was not before, but a count can now be lower if you use `listWhere`.
