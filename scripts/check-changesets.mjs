#!/usr/bin/env node
/**
 * Validates every pending `.changeset/*.md` against the format contract.
 * Run locally as `pnpm run lint:changesets`, and in CI from the
 * `changeset-check` job.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChangeset } from './changeset-rules.mjs';

const SKILL = '.claude/skills/writing-changesets/SKILL.md';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.changeset');

const entries = (await fs.readdir(dir))
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort();

/** @type {string[]} */
const errors = [];
for (const name of entries) {
  const contents = await fs.readFile(path.join(dir, name), 'utf8');
  errors.push(...validateChangeset(name, contents));
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  console.error(
    `\n${errors.length} problem(s) in ${entries.length} changeset(s). If you are an AI agent: read ${SKILL} — it defines the tag vocabulary, the length cap and the single-paragraph rule, and shows worked rewrites.`
  );
  process.exit(1);
}

console.log(`${entries.length} changeset(s) OK.`);
