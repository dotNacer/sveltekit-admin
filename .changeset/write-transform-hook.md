---
"sveltekit-admin": minor
---

Add a write-transform hook (`models[].transform`) to change a submitted field's value right before it is written — e.g. hashing a password with bcrypt/argon2/better-auth instead of writing the raw form value. Runs inline in the mutation path, supports async, works identically on the Prisma and Drizzle adapters, never fires on a `scope` (tenant) column, and a throw inside the transform surfaces as a normal validation error naming the field.
