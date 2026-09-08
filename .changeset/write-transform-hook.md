---
"sveltekit-admin": minor
---

feat: **A write-transform hook, `models[].transform`.** Change a field's value right before it's written — e.g. hashing a password with bcrypt/argon2. Runs inline, supports async, works on Prisma and Drizzle, never touches a `scope` column; a throw becomes a validation error naming the field.
