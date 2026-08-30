---
"sveltekit-admin": minor
---

Verify the `Origin` header on every state-changing request the admin serves (create, update, delete, `_logout`, `_search`), and add a **`csrf`** option (`false | { trustedOrigins?: string[] }`). The check runs before routing, so it covers `_logout` (dispatched before `authCheck` by design) and any route added later; a rejected request gets a static `403` and never reaches the adapter. `GET`/`HEAD`/`OPTIONS` and anything outside `basePath` are untouched.

SvelteKit's `kit.csrf.checkOrigin` can't carry this guarantee for the admin: it runs before the `handle` hook so the handler never observes it, a `checkOrigin: false` set for an unrelated route (a payment webhook, say) disables it everywhere, and it is skipped in development — so a proxy that strips `Origin` only surfaces in production. A missing `Origin` is rejected, matching SvelteKit's semantics. `trustedOrigins` entries are normalized at startup (`https://ops.example.com/` and `https://ops.example.com` are one entry); an entry that is not an absolute URL, or whose origin is opaque (`"null"`, as a sandboxed iframe sends), throws from `createAdminHandler` rather than being ignored per-request. This is a cross-site defense only: with no per-session token, a compromised same-origin context needs origin isolation.
