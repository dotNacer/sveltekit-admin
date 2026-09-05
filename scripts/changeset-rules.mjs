/**
 * Single source of truth for the changeset format.
 *
 * Read by both the linter (`check-changesets.mjs`) and the changelog
 * regrouper (`format-changelog.mjs`). A second copy of the tag vocabulary
 * drifting from this one is the bug class CLAUDE.md already documents for
 * `isSensitiveFieldName` — don't reintroduce it.
 */

/**
 * Sections in the order they appear in a changelog entry.
 * @type {ReadonlyArray<{ tag: string; title: string; bump: 'major' | 'minor' | 'patch' }>}
 */
export const SECTIONS = [
  { tag: 'breaking', title: 'Breaking changes', bump: 'major' },
  { tag: 'feat', title: 'Features', bump: 'minor' },
  { tag: 'improvement', title: 'Improvements', bump: 'patch' },
  { tag: 'fix', title: 'Fixes', bump: 'patch' }
];

/** @type {string[]} */
export const TAGS = SECTIONS.map((s) => s.tag);

export const SUMMARY_LIMIT = 300;
export const BREAKING_SUMMARY_LIMIT = 600;

/** A tag at the very start of a changeset body. */
const BODY_TAG_RE = new RegExp(`^(${TAGS.join('|')}):[ \\t]`);

/**
 * A tag anywhere inside a body or changelog bullet. Built fresh to avoid a
 * shared `lastIndex`. Used both by `validateChangeset` (a body may carry only
 * its one opening tag — any other match must be backticked) and by
 * `formatChangelog` (a bullet must carry exactly one tag to regroup). One
 * pattern, so the two cannot disagree about what counts as a tag.
 */
function tagPattern(flags = '') {
  return new RegExp(`\\b(${TAGS.join('|')}):[ \\t]`, flags);
}

/**
 * The same frontmatter regex `@changesets/parse` uses, so this linter and the
 * tool agree on what a changeset file is.
 */
const FRONTMATTER_RE = /\s*---([^]*?)\r?\n\s*---(\s*(?:\n|$)[^]*)/;

/**
 * @param {string} contents
 * @returns {{ frontmatter: string; body: string } | null}
 */
export function splitChangeset(contents) {
  const match = FRONTMATTER_RE.exec(contents);
  if (!match) return null;
  // The capture keeps the newline that follows the opening `---`; trim it so
  // callers see the frontmatter text alone.
  return { frontmatter: match[1].trim(), body: match[2].trim() };
}

/**
 * @param {string} frontmatter
 * @returns {{ empty: true } | { empty: false; bump: string | null }}
 */
export function readBump(frontmatter) {
  if (frontmatter.trim() === '') return { empty: true };
  const match =
    /^\s*['"]?sveltekit-admin['"]?\s*:\s*['"]?(major|minor|patch|none)['"]?\s*$/m.exec(frontmatter);
  return { empty: false, bump: match ? match[1] : null };
}

/**
 * @param {string} tag
 * @returns {number}
 */
export function limitFor(tag) {
  return tag === 'breaking' ? BREAKING_SUMMARY_LIMIT : SUMMARY_LIMIT;
}

/**
 * Length as the reader experiences it: soft wraps collapse to one space, and
 * markdown markup counts because it is what they scan past.
 * @param {string} summary
 * @returns {number}
 */
export function summaryLength(summary) {
  return summary.replace(/\s+/g, ' ').trim().length;
}

/**
 * @param {string} filename
 * @param {string} contents
 * @returns {string[]} human-readable errors; empty when the file is valid
 */
export function validateChangeset(filename, contents) {
  /** @param {string} message */
  const at = (message) => `${filename}: ${message}`;
  const tagList = TAGS.map((t) => `\`${t}:\``).join(', ');

  const split = splitChangeset(contents);
  if (!split) {
    return [at('missing or malformed frontmatter (expected a `---` delimited block).')];
  }

  const { frontmatter, body } = split;
  if (body === '') return [at('body is empty.')];

  const frontmatterInfo = readBump(frontmatter);
  // An empty changeset owes nothing but a non-empty one-line body.
  if (frontmatterInfo.empty) return [];

  /** @type {string[]} */
  const errors = [];
  if (frontmatterInfo.bump === null) {
    errors.push(at("frontmatter must read `'sveltekit-admin': major|minor|patch`."));
  }

  const tagMatch = BODY_TAG_RE.exec(body);
  if (!tagMatch) {
    errors.push(at(`body must start with one of ${tagList}.`));
    return errors;
  }

  const tag = tagMatch[1];
  const summary = body.slice(tagMatch[0].length);
  // `tag` provably came from TAGS, so the lookup cannot miss.
  const section = /** @type {{ tag: string; title: string; bump: string }} */ (
    SECTIONS.find((s) => s.tag === tag)
  );

  if (frontmatterInfo.bump !== null && frontmatterInfo.bump !== section.bump) {
    errors.push(
      at(
        `tag \`${tag}:\` requires bump \`${section.bump}\`, frontmatter says \`${frontmatterInfo.bump}\`.`
      )
    );
  }

  const extra = (body.match(tagPattern('g')) ?? []).length - 1;
  if (extra > 0) {
    errors.push(
      at(
        `body carries ${extra + 1} tags; only the opener may be one — backtick the others (\`fix:\`).`
      )
    );
  }

  if (/\n[ \t]*\n/.test(body)) {
    errors.push(at('body must be a single paragraph (found a blank line).'));
  }
  if (/^[ \t]*#/m.test(body)) {
    errors.push(at('body must not contain a markdown heading.'));
  }
  if (/^[ \t]*```/m.test(body)) {
    errors.push(at('body must not contain a fenced code block.'));
  }

  const length = summaryLength(summary);
  const limit = limitFor(tag);
  if (length > limit) {
    errors.push(at(`summary is ${length} characters, limit is ${limit} for \`${tag}:\`.`));
  }

  return errors;
}

/**
 * Regroup the newest `## <version>` block of a changelog by tag.
 *
 * Only the newest block is touched; earlier versions keep whatever shape they
 * were released with. Fails without rewriting anything rather than emitting a
 * half-sorted changelog.
 *
 * @param {string} content
 * @returns {{ output: string; errors: string[]; changed: boolean }}
 */
export function formatChangelog(content) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => /^## /.test(line));
  if (start === -1) {
    return { output: content, errors: ['CHANGELOG.md: no `## <version>` heading found.'], changed: false };
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  /** @type {string[][]} */
  const collected = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^- /.test(line)) collected.push([line]);
    else if (/^#{1,6} /.test(line)) continue;
    else if (collected.length > 0) collected[collected.length - 1].push(line);
  }

  const bullets = collected.map((b) => b.join('\n').replace(/\s+$/, '')).filter((b) => b !== '');
  if (bullets.length === 0) {
    return {
      output: content,
      errors: [`CHANGELOG.md: version block "${lines[start].slice(3).trim()}" has no bullets.`],
      changed: false
    };
  }

  // Already formatted: no bullet carries a tag, so there is nothing to move.
  if (bullets.every((bullet) => !tagPattern().test(bullet))) {
    return { output: content, errors: [], changed: false };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, string[]>} */
  const buckets = new Map(SECTIONS.map((section) => [section.tag, []]));

  for (const bullet of bullets) {
    const found = bullet.match(tagPattern('g')) ?? [];
    if (found.length !== 1) {
      errors.push(
        `CHANGELOG.md: bullet carries ${found.length} tags, expected exactly 1: ${bullet.split('\n')[0]}`
      );
      continue;
    }
    const match = /** @type {RegExpExecArray} */ (tagPattern().exec(bullet));
    const stripped = (bullet.slice(0, match.index) + bullet.slice(match.index + match[0].length))
      .replace(/^- +/, '- ');
    /** @type {string[]} */ (buckets.get(match[1])).push(stripped);
  }

  if (errors.length > 0) return { output: content, errors, changed: false };

  /** @type {string[]} */
  const rendered = [];
  for (const section of SECTIONS) {
    const items = /** @type {string[]} */ (buckets.get(section.tag));
    if (items.length === 0) continue;
    rendered.push(`### ${section.title}`, '', ...items, '');
  }
  rendered.pop();

  const tail = end < lines.length ? ['', ...lines.slice(end)] : content.endsWith('\n') ? [''] : [];
  const output = [...lines.slice(0, start + 1), '', ...rendered, ...tail].join('\n');
  return { output, errors: [], changed: true };
}
