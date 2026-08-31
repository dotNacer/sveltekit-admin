---
"sveltekit-admin": minor
---

**Rows can be selected in the list and deleted together.** Each row carries a checkbox, the header carries a "select all on this page" control, and **Delete selected** removes them in one operation, after a confirmation prompt.

It is one operation rather than a loop over the existing single delete, and that is the point of the design. A loop that fails on the seventh row because of a foreign-key constraint leaves six rows gone and nothing to undo them with. Here there are two possible outcomes: everything selected is deleted, or nothing is and the list says one of the rows is still referenced.

**`models[].scope` is composed with the selected ids inside the query**, not checked separately. An out-of-scope id matches nothing and raises nothing, so the result never distinguishes "does not exist" from "belongs to another tenant" — the redirect reports how many rows were actually deleted, and a gap against what was selected can only come from a forged POST, since the UI offers nothing out of scope.

**A selection larger than 200 ids is refused.** The UI can only tick what it displays, and an `IN (…)` of several thousand entries is a load vector on its own.

**The audit log gets one `delete` entry per row**, each with its `before` snapshot, read with the same scope as the deletion — the log records exactly the rows that went. Without that, the most destructive operation in the admin would have been the one thing the log stayed silent about.

`DataAdapter` gains `deleteMany(model, ids, authorizationFilter)`, implemented by both the Prisma and Drizzle adapters. A custom adapter needs to implement it before bulk delete works against it. On the Drizzle side, many-to-many pivot rows are cleared for the rows being deleted **and only those** — composing the scope into the pivot delete instead would have stripped the relations of an out-of-scope row that the parent delete leaves untouched.

The redirect carries `?deleted=N` for the confirmation banner. That parameter is dropped from every link the list then builds, the way `page` already is: it reports an action, it is not list state, and left alone it would follow you through every filter and page click.

The checkboxes work without JavaScript; only "select all on this page" needs it.
