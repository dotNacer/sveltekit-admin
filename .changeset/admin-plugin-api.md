---
"sveltekit-admin": minor
---

Add a **`plugins`** option on `createAdminHandler` and export the `AdminPlugin` types (new pages inside the existing layout, record-row / edit-screen links, inline CSS/JS). Plugin reads go through scoped helpers (`listWhere` plus `hidden` / sensitive-field redaction), not the ORM client. Omitting `plugins` leaves `createAdminHandler({ prisma })` unchanged.
