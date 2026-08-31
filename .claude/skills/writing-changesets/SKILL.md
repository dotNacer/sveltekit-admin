---
name: writing-changesets
description: Use when adding a .changeset/*.md file for a sveltekit-admin change — before picking the patch/minor/major bump type, before writing its prose body, or when a PR touches more than one independent behavior.
---

# Writing Changesets

## Overview

One `.changeset/*.md` file per atomic, PR-level change. Its body becomes the
`CHANGELOG.md` entry verbatim when the version is cut — write the entry once,
here, not as a draft to be rewritten later. See `CONTRIBUTING.md` for the
release process this feeds into; this skill only covers authoring the file
itself.

## Bump type: sharper than "new capability vs bug fix"

`CONTRIBUTING.md`'s three-line definition (MAJOR breaks the API, MINOR adds a
capability, PATCH fixes/improves) reads MINOR for anything additive — that's
too coarse. The line that actually matters:

**Does this change add a new export, a new config option, or a capability a
user could not get at all before?** → MINOR.
**Does this widen/refine what an existing feature already does — matches more
cases, fixes a bug, improves performance — with no new config surface and no
new export?** → PATCH.

Worked precedent from this project's own history:
- `0.5.0` added the entire `?q=` search feature plus the `searchFields` /
  `listFilter` config options — genuinely new capability → **MINOR**.
- `0.5.1` widened the auto-detected search-field heuristic (recognizing
  `description`, `content`, `body`, `text` in addition to the existing list)
  — no new config option, no new export, just more cases matched by a
  heuristic that already existed → **PATCH**, not MINOR, even though "more
  fields get searched" sounds additive in isolation.

Same logic applies to detection heuristics, error messages, default values,
internal query shape, and performance work: refining something that already
exists is PATCH; giving the consumer a new lever or new surface is MINOR.

MAJOR stays reserved for removing/renaming an export or changing a documented
config shape/behavior in a way existing callers must react to — see
`CONTRIBUTING.md` for the pre-`1.0.0` nuance on that.

## Organization

- One logical change = one file. A PR with two unrelated behavior changes
  gets two changeset files, each with its own bump type — the release picks
  the highest among all pending changesets, but each still gets its own
  changelog line.
- Name the file descriptively in kebab-case, e.g.
  `widen-search-heuristic.md` — not a random adjective-noun slug. You're
  writing this by hand, not running the interactive `changeset` CLI that
  generates those; a descriptive name is what the next person reads in
  `git blame` or the `.changeset/` directory listing.
- A change with no effect on published behavior (tests, CI, internal dev
  tooling, docs) still gets a file — an **empty** changeset, frontmatter with
  no package and no bump, plus a one-line body:

  ```md
  ---
  ---

  Docs only — nothing published changes. <what this PR does>
  ```

  Do **not** omit the file. The `changeset-check` job runs
  `changeset status --since=origin/main`, which reports the package as changed
  for *any* modified file — so a docs-only or test-only PR with no changeset
  fails CI exactly like a source PR would. Precedent:
  `.changeset/scope-migration-docs.md` (#35),
  `.changeset/fix-automated-release.md` (#38).

## Content: writing the body

The body is the changelog entry verbatim, so match the voice already in
`CHANGELOG.md`:

- Backtick every identifier: function names, config option names, field
  names, file paths.
- State the concrete mechanism or root cause → consequence, not a vague
  summary. "Fixes a bug in list filtering" is not enough; say what broke, for
  whom, and under what condition.
- Call out explicitly what's *unaffected* when a reader might otherwise
  wonder ("no config change required for models that already set
  `searchFields`").
- Bold the feature name only when introducing something genuinely new
  (MINOR-style), never for a refinement or fix.
- Don't add `### Added`/`### Changed`/`### Fixed` headers inside the file —
  that grouping now comes from the bump type once versions are cut, not from
  a hand-picked section.

## Format

```md
---
"sveltekit-admin": patch
---

Prose description — this exact text becomes the CHANGELOG.md entry.
```

## Quick reference

| Signal | Bump |
|---|---|
| New exported function/component, new config option | MINOR |
| Existing heuristic/detection now matches more cases | PATCH |
| Bug fix, perf improvement, internal-only change | PATCH |
| Export removed/renamed, documented behavior changed incompatibly | MAJOR (see `CONTRIBUTING.md` for pre-`1.0.0` handling) |
