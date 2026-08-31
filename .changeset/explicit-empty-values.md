---
"sveltekit-admin": minor
---

**An empty form field now means `null` on every column type, and is refused on a column that does not accept `NULL`.**

`formDataToPrisma` was inconsistent about what "empty" meant: an emptied `Int`, `Float`, `DateTime` or `Json` field became `null`, but an emptied `String` became `""`. That difference was invisible until it wasn't — a `String? @unique` column accepted the first blanked row and rejected the second on a unique violation, and a column blanked from the admin came back as `""` where the rest of the app tested for `null`.

An emptied `String` (and an emptied enum) now writes `null`, like every other type already did.

**A column declared non-nullable can no longer be saved empty.** It answers `422` with `<field> is required` attached to the field, keeping the submitted form intact, instead of writing `""` and answering `303` as if it had worked — or, for a numeric column, sending `null` to the driver and coming back with a generic message naming no field. This is the same rule already applied to required sensitive columns on create, now applied to every scalar type.

Two distinctions the check deliberately preserves:

- **A field absent from the POST is not an empty field.** A readonly field, a hidden one, or a column with a `@default` that the create form does not render, submits nothing — the key stays out of the payload and the column is not written. Only a key that is *present* and empty counts as a value the user cleared.
- **A scope column left empty is still imposed, not refused.** The check runs after `models[].scope` is applied, so a model whose tenant column is required and visible stays creatable from the admin — the create form renders that column empty by design, and treating that as a refusal would make the model impossible to create. Relation scalars are likewise still owned by the FK validation that runs before, so an empty required relation keeps reporting as `author is required` rather than `authorId is required`.

If your app relies on the admin writing `""` into a required `String` column, that submit is now refused. Make the column nullable, or give it a `@default("")`.
