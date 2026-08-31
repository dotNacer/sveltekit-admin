---
"sveltekit-admin": minor
---

A `String` field whose name matches `isSensitiveFieldName` (`password`, `passwordHash`, `apiToken`, `clientSecret`…) is no longer treated as an ordinary text column by the form and the write path.

**The edit form no longer renders it at all.** It used to render the stored value into the HTML, so any user's password hash was readable from view-source, the devtools, a screenshot or a screen share by anyone allowed to *edit* that record — a weaker permission than being allowed to *read* the credential. `models[].hidden` and `isSensitiveFieldName` already closed list display, `?q=` search, `?f.*=` filters and the audit payload; the form was the one path left open.

**An update never writes the column.** It previously rewrote it on every save, which only appeared harmless because the rendered value round-tripped back. With the field gone from the form, a value arriving in a POST did not come from the UI, so it is dropped rather than written — no error, since this is data that was not asked for rather than data that was refused. Editing a record's name no longer touches its credential.

**A create still offers the field**, because nothing is stored yet to leak and removing it would make a model with a required sensitive column impossible to create from the admin. What changes there: an empty value on a required column is now refused with a `422` and `password is required` on the field, instead of silently writing `""` and answering `303` as if it had worked — which produced an account with an unusable credential. An empty value on an *optional* column omits the key rather than writing `""`, since `""` is indistinguishable from a secret that genuinely is the empty string.

The type filter matters: the rule applies to `String` columns only. `isSensitiveFieldName` matches by substring, so without it an `Int` named `tokenCount` or `hashtagCount` would have become uneditable in the admin. It stays visible and editable.

This also closes a hole opened in `0.9.0`: a refused update re-rendered the sensitive field empty (correctly), and the next save then wrote `""` over the hash. Preserving the value across a refused submit had only ever worked by accident, through the round-trip of the value that should not have been rendered in the first place.

Note for anyone who used the admin to set passwords: the value is written to the column verbatim, with no hashing — it always was. There is no transform hook yet, so a create form that sets a password stores plaintext. Put the field in `models[].hidden` and manage credentials in your own app until a write-transform hook exists.
