---
---

Tooling only — nothing published changes. Adds `pnpm run smoke:packaged` and a `packaged-consumer` CI job that pack the library, install the tarball into a copy of `example/` outside the workspace, build it with Vite, boot it and drive it over HTTP — so the published artifact is verified rather than assumed.
