---
name: writing-changesets
description: Use when adding a .changeset/*.md file for a sveltekit-admin change — before picking the patch/minor/major bump, before choosing the breaking:/feat:/improvement:/fix: tag that opens the body, before writing the one-paragraph summary, or when a PR touches more than one independent behavior.
---

# Writing Changesets

## Overview

One `.changeset/*.md` per atomic change. Its body becomes the `CHANGELOG.md` bullet
verbatim, and `changesets/action` builds the GitHub release from `CHANGELOG.md`.
What you write here is what a reader of the release sees, unedited.

The audience is someone scanning a release to answer "what can I do now that I couldn't
before". The engineering reasoning (why one atomic delete instead of a loop, which
regex was wrong, what the race was) goes in the **PR description**. That reasoning is not
being discarded; it is filed next to the diff, where it gets read, instead of in the
file someone consults to decide whether to upgrade. Write it there in full. A rule
that has to outlive the PR goes to `CLAUDE.md` or a source comment instead, where the
next person meets it while touching the code it guards.

- One logical change = one file. A PR with two unrelated behavior changes gets two
  changesets, each with its own bump and its own tag; the release takes the highest bump
  and still prints both bullets.
- Name the file in kebab-case after the change: `widen-search-heuristic.md`. You are
  writing it by hand, not through the interactive `changeset` CLI that emits names like
  `ready-needles-cover.md`, and this name is what the next reader sees in `git blame`
  and in the `.changeset/` listing.

## Format

```md
---
'sveltekit-admin': minor
---

feat: **Column sorting in list views.** Every column heading is a link; `?sort=` and `&dir=` live in the URL and compose with the active search and filters.
```

## Tags

The body opens with exactly one tag, lowercase, followed by a space. The tag decides
which changelog section the bullet lands in, and it must agree with the frontmatter
bump. A mismatch fails the linter, which makes the tag a second check on a bump that
has drifted before (all eleven `0.9.0` entries shipped as `minor`; two were refinements
of existing behavior).

| Tag | Bump | Use when the change |
|---|---|---|
| `breaking:` | `major` | forces existing callers to react |
| `feat:` | `minor` | gives a new lever or a new surface |
| `improvement:` | `patch` | refines something that already worked |
| `fix:` | `patch` | repairs something that was wrong |

## Hard limits

- **300 characters** of summary: tag excluded, markdown markup included, since
  backticks and asterisks are part of what the reader scans past. **600** for
  `breaking:`, which owes both what breaks and what to do about it.
- **One paragraph.** No blank line, no markdown heading, no fenced block; inline
  backticks are welcome. This rule, not the cap, is what makes a subtitled essay
  structurally impossible.
- Run `pnpm run lint:changesets` before pushing. It checks the tag, the tag/bump
  agreement, the cap and the paragraph rule, and CI runs it in the `changeset-check`
  job.

The five rewrites below land between 169 and 188 characters, under two thirds of the
cap. Real content fits under it; the essay does not.

## Editorial rules

1. **Open on the capability, not the event.** "Column sorting in list views", not
   "Added the ability to sort list views". `Added`, `Fixed` and `Improved` are banned as
   sentence openers: the `### Features` or `### Fixes` heading above the bullet already
   says it. `### Features` plus `Added…` on all eleven items is the costliest redundancy
   in the current changelog.
2. **No sentence paraphrases the first.** The dominant defect today: the first sentence
   names the feature, the second says the same thing at greater length. Every sentence
   after the first must carry something the first does not already imply.
3. **Backtick the visible surface**: `perPage`, `models[].defaultSort`, `?sort=`. A
   reader deciding "does this concern me" scans identifiers.
4. **The second clause gives the consequence, or nothing.** Not the internals.
   "sorting lives in the URL, so it survives a bookmark" is a consequence. "the name
   from the URL is looked up in that whitelist and never reaches the query as a key" is
   internals; that sentence belongs in the PR description.
5. **No meta-commentary**: "this is deliberate", "the point of the design is", "worth
   knowing if you maintain a fork".
6. **No filler**: `essentially`, `effectively`, `simply`, `just`, `note that`,
   `it's worth noting`.
7. **A new option states its default**, in one parenthesis: `` `perPage` (default 20) ``.
8. **Don't say what stays the same.** No change is the reader's default assumption, and
   asserting it doubles the length of the entry for nothing.
9. **`breaking:` says what breaks, then the migration, in the imperative.** "Make the
   column nullable, or give it a `@default('')`."
10. **`feat:` and `breaking:` open on a bold lead phrase; `improvement:` and `fix:` are a
    plain sentence with no bold.** The contrast is what carries the information to
    someone skimming.

## Worked rewrites

Real `0.9.0` entries. Each block below replaces its entry in full. Pattern-match
against these before writing your own.

**2044 chars → 188**

```md
feat: **Column sorting in list views.** Every column heading is a link; `?sort=` and `&dir=` live in the URL and compose with the active search and filters. Only displayed columns can be sorted.
```

**2277 chars → 185**

```md
feat: **Rows can be selected and deleted together.** A checkbox per row, a select-all for the page, and one atomic operation — either every selected row goes or none does. Capped at 200 rows.
```

**2153 chars → 169**

```md
fix: An emptied form field now writes `null` on every column type, not `""` for strings. A required column can no longer be saved empty — it answers 422 with the field named.
```

**1892 chars → 170**

```md
feat: **An accessibility and responsive baseline.** Visible focus on every control, a working layout below 900px, a skip-to-content link, and `prefers-reduced-motion` honoured.
```

**1441 chars → 173**

```md
feat: **`perPage` and `pageSizeOptions` configure list page size** (default 20, selector offering 10/20/50/100). `?perPage=` is honoured only for offered sizes, and capped at 200.
```

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

## Empty changesets

A change with no effect on published behavior (tests, CI, internal dev tooling, docs)
still gets a file — an **empty** changeset, frontmatter with no package and no bump,
plus a one-line body:

```md
---
---

Docs only — nothing published changes. <what this PR does>
```

It takes no tag, is subject to no cap, and produces no changelog line.

Do **not** omit the file. The `changeset-check` job runs
`changeset status --since=origin/main`, which reports the package as changed
for *any* modified file — so a docs-only or test-only PR with no changeset
fails CI exactly like a source PR would. Precedent:
`.changeset/scope-migration-docs.md` (#35),
`.changeset/fix-automated-release.md` (#38).
