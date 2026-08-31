---
"sveltekit-admin": minor
---

**An `enum` column is now edited through a `<select>` instead of a free-text input.** The form rendered every enum field as `<input type="text">`, so setting one meant typing a value from the schema by hand, with a typo answered by whatever the driver said about an invalid enum — a generic "The change could not be saved." that named no field.

The widget mirrors `RelationSelect` (same markup, same `— aucun —` for a nullable column) with two deliberate differences. A non-nullable column with no value yet renders a disabled placeholder option: without it the browser preselects the first declared value, and a create would write a choice the user never made. And a readonly enum renders `disabled` rather than `readonly`, which `<select>` does not support — the field then leaves the POST entirely, `formDataToPrisma` skips the absent key, and the column is not rewritten.

**The submitted value is revalidated server-side**, like every FK and m2m target already is: a value outside the declared domain is refused with a `422` and `role: invalid value` on the field, keeping the submitted form intact, instead of reaching the driver. A forged POST does not get to write a value the `<select>` would never have offered.

Selecting `— aucun —` on a nullable enum writes `null`. It previously would have written `""`, which no enum type declares and every driver rejects. An empty value on a non-nullable enum is refused with `role is required` rather than passed through.

No config change is required: enum values come from the schema the adapter already introspects, for both the Prisma and Drizzle adapters. `ViewModel` gains an `enums` map, filled by the runtime; a `ViewModel` built by hand without it degrades to the previous text input.
