---
"sveltekit-admin": minor
---

**A `Bytes` column is no longer rendered in forms**, and a value that cannot be converted to its column's type is refused instead of silently written.

`Bytes` had no widget of its own, so it fell through to the generic text branch and rendered as `<input type="text">`. That input could never work: the driver expects a `Uint8Array` and was handed a string, so every save on such a column failed. The column is now excluded from create and edit forms, the way list views already excluded it. A model with a required `Bytes` column cannot be created from the admin — that was already true in practice, except the failure now happens before the form instead of after the POST.

**Unparseable JSON is refused** with a `422` and `metadata: invalid value` on the field, submitted form preserved. It used to be written as `null` without a word, which lost both what was typed and what the row already held, behind a `303` that looked successful. A number field carrying something that is not a number is refused the same way, rather than sending `NaN` to the driver and coming back with a generic message naming no field.

Foreign-key scalars keep their own error: an unparseable id still reports as `author: invalid id` on the relation, not `authorId: invalid value` on the scalar.

`formDataToPrisma` now returns `{ data, invalid }` instead of the payload alone. It is not exported from the package, so this is internal only.

The **Field Types** documentation page is rewritten around this: what each type renders as (including the enum `<select>` added in the previous release), what an empty field writes, which types are not editable, and the two precision limits that never raise an error — `BigInt` goes through `parseInt` so values above `2^53 - 1` lose precision, and `Decimal` goes through `parseFloat`. It also corrected a stale claim that edit forms still render sensitive fields normally; they have not since sensitive columns were closed off on the write path.
