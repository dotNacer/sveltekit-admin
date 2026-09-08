#!/usr/bin/env node
/**
 * Regroups the newest CHANGELOG.md entry by tag, after `changeset version`.
 *
 * This is the only place the release notes get their shape: `changesets/action`
 * reads CHANGELOG.md at publish time (`run.ts`, `createRelease`) and slices the
 * block between the version heading and the next heading of the same depth, so
 * whatever this script writes becomes the GitHub release body verbatim.
 *
 * Why `package.json` pins `@changesets/changelog-github` to an exact `1.0.1`,
 * not `^1.0.1`: `.changeset/config.json`'s `template` option (`"- {summary} {ref}"`,
 * the shape this script's output relies on) is upstream-declared experimental —
 * its own README says the token syntax may change in any release, including a
 * patch, and to pin exactly if you depend on it. There is no dependabot here,
 * so nothing else will re-flag a `^` added back by a routine dependency sweep.
 * JSON cannot carry a comment explaining the pin, so this header is that comment.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatChangelog } from './changeset-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'CHANGELOG.md');

const content = await fs.readFile(file, 'utf8');
const { output, errors, changed } = formatChangelog(content);

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}

if (!changed) {
  console.log('CHANGELOG.md: newest entry already grouped, nothing to do.');
} else {
  await fs.writeFile(file, output);
  console.log('CHANGELOG.md: newest entry grouped by tag.');
}
