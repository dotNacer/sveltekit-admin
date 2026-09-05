import { describe, it, expect } from 'vitest';
import {
  SECTIONS,
  TAGS,
  SUMMARY_LIMIT,
  BREAKING_SUMMARY_LIMIT,
  splitChangeset,
  readBump,
  summaryLength,
  limitFor,
  validateChangeset,
  formatChangelog
} from '../../scripts/changeset-rules.mjs';

const cs = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}\n`;
const valid = (body: string, bump = 'minor') => cs(`'sveltekit-admin': ${bump}`, body);

describe('constants', () => {
  it('orders sections breaking, feat, improvement, fix', () => {
    expect(SECTIONS.map((s) => s.tag)).toEqual(['breaking', 'feat', 'improvement', 'fix']);
    expect(SECTIONS.map((s) => s.title)).toEqual([
      'Breaking changes',
      'Features',
      'Improvements',
      'Fixes'
    ]);
    expect(SECTIONS.map((s) => s.bump)).toEqual(['major', 'minor', 'patch', 'patch']);
    expect(TAGS).toEqual(['breaking', 'feat', 'improvement', 'fix']);
  });

  it('caps are 300 and 600', () => {
    expect(SUMMARY_LIMIT).toBe(300);
    expect(BREAKING_SUMMARY_LIMIT).toBe(600);
    expect(limitFor('fix')).toBe(300);
    expect(limitFor('breaking')).toBe(600);
  });
});

describe('splitChangeset', () => {
  it('splits frontmatter from body', () => {
    expect(splitChangeset(valid('feat: X.'))).toEqual({
      frontmatter: "'sveltekit-admin': minor",
      body: 'feat: X.'
    });
  });

  it('accepts the empty-changeset shape', () => {
    expect(splitChangeset('---\n---\n\nDocs only.\n')).toEqual({
      frontmatter: '',
      body: 'Docs only.'
    });
  });

  it('returns null without frontmatter', () => {
    expect(splitChangeset('feat: no frontmatter here.')).toBeNull();
  });
});

describe('readBump', () => {
  it('reads a quoted bump', () => {
    expect(readBump("'sveltekit-admin': patch")).toEqual({ empty: false, bump: 'patch' });
  });

  it('reads an unquoted bump', () => {
    expect(readBump('sveltekit-admin: major')).toEqual({ empty: false, bump: 'major' });
  });

  it('reports an empty frontmatter', () => {
    expect(readBump('  \n ')).toEqual({ empty: true });
  });

  it('reports an unreadable non-empty frontmatter', () => {
    expect(readBump('some-other-package: minor')).toEqual({ empty: false, bump: null });
  });
});

describe('summaryLength', () => {
  it('collapses soft wraps and counts markdown', () => {
    expect(summaryLength('**a**\nb')).toBe(7); // "**a** b"
    expect(summaryLength('  a   b  ')).toBe(3);
  });
});

describe('validateChangeset', () => {
  it('accepts a well-formed changeset', () => {
    expect(validateChangeset('x.md', valid('feat: **X.** It does a thing.'))).toEqual([]);
  });

  it('accepts a soft-wrapped body as one paragraph', () => {
    expect(validateChangeset('x.md', valid('feat: **X.** It does\na thing.'))).toEqual([]);
  });

  it('accepts an empty changeset without a tag', () => {
    expect(validateChangeset('x.md', '---\n---\n\nDocs only — nothing published changes.\n')).toEqual(
      []
    );
  });

  it('rejects a missing frontmatter', () => {
    expect(validateChangeset('x.md', 'feat: X.')[0]).toContain('frontmatter');
  });

  it('rejects a non-empty frontmatter naming no readable sveltekit-admin bump', () => {
    const [error] = validateChangeset(
      'x.md',
      "---\nsome-other-package: minor\n---\n\nfeat: X.\n"
    );
    expect(error).toContain("frontmatter must read `'sveltekit-admin': major|minor|patch`");
  });

  it('rejects an empty body', () => {
    expect(validateChangeset('x.md', "---\n'sveltekit-admin': minor\n---\n\n")[0]).toContain(
      'body is empty'
    );
  });

  it('rejects a missing tag and names the four', () => {
    const [error] = validateChangeset('x.md', valid('Adds column sorting.'));
    expect(error).toContain('`feat:`');
    expect(error).toContain('`breaking:`');
  });

  it('rejects an unknown tag', () => {
    expect(validateChangeset('x.md', valid('chore: tidy up.'))[0]).toContain('`feat:`');
  });

  it('rejects a tag contradicting the bump', () => {
    const [error] = validateChangeset('x.md', valid('fix: A thing was wrong.', 'minor'));
    expect(error).toContain('requires bump `patch`');
    expect(error).toContain('frontmatter says `minor`');
  });

  it.each([
    ['breaking: It breaks. Do this.', 'major'],
    ['feat: **X.** New lever.', 'minor'],
    ['improvement: X is faster now.', 'patch'],
    ['fix: X was wrong.', 'patch']
  ])('accepts %s with bump %s', (body, bump) => {
    expect(validateChangeset('x.md', valid(body, bump))).toEqual([]);
  });

  it('rejects a blank line in the body', () => {
    expect(validateChangeset('x.md', valid('feat: **X.**\n\nMore prose.'))[0]).toContain(
      'single paragraph'
    );
  });

  it('rejects a markdown heading', () => {
    expect(validateChangeset('x.md', valid('feat: **X.**\n### Why'))[0]).toContain('heading');
  });

  it('rejects a fenced code block', () => {
    expect(validateChangeset('x.md', valid('feat: **X.**\n```ts\nfoo()\n```'))[0]).toContain(
      'fenced code block'
    );
  });

  it('accepts a summary at exactly the cap and rejects one over', () => {
    expect(validateChangeset('x.md', valid(`fix: ${'a'.repeat(300)}`, 'patch'))).toEqual([]);
    const [error] = validateChangeset('x.md', valid(`fix: ${'a'.repeat(301)}`, 'patch'));
    expect(error).toContain('301 characters');
    expect(error).toContain('limit is 300');
  });

  it('gives breaking a 600 cap', () => {
    expect(validateChangeset('x.md', valid(`breaking: ${'a'.repeat(600)}`, 'major'))).toEqual([]);
    expect(validateChangeset('x.md', valid(`breaking: ${'a'.repeat(601)}`, 'major'))[0]).toContain(
      'limit is 600'
    );
  });

  it('prefixes every error with the filename', () => {
    for (const error of validateChangeset('my-change.md', valid('nope.'))) {
      expect(error.startsWith('my-change.md: ')).toBe(true);
    }
  });
});

describe('formatChangelog', () => {
  const changelog = (body: string) => `# Changelog\n\n## 0.10.0\n\n${body}\n\n## 0.9.0\n\nold stuff\n`;

  it('regroups bullets by tag, in section order', () => {
    const { output, errors, changed } = formatChangelog(
      changelog(
        [
          '### Minor Changes',
          '',
          '- feat: **Column sorting.** Headings are links. ([#42](u))',
          '- fix: An emptied field writes `null`. ([#37](u))',
          '- breaking: It breaks. Do this. ([#50](u))',
          '- improvement: Faster now. ([#39](u))'
        ].join('\n')
      )
    );
    expect(errors).toEqual([]);
    expect(changed).toBe(true);
    expect(output).toBe(
      [
        '# Changelog',
        '',
        '## 0.10.0',
        '',
        '### Breaking changes',
        '',
        '- It breaks. Do this. ([#50](u))',
        '',
        '### Features',
        '',
        '- **Column sorting.** Headings are links. ([#42](u))',
        '',
        '### Improvements',
        '',
        '- Faster now. ([#39](u))',
        '',
        '### Fixes',
        '',
        '- An emptied field writes `null`. ([#37](u))',
        '',
        '## 0.9.0',
        '',
        'old stuff',
        ''
      ].join('\n')
    );
  });

  it('omits empty sections', () => {
    const { output } = formatChangelog(changelog('- fix: A was wrong. ([#1](u))'));
    expect(output).toContain('### Fixes');
    expect(output).not.toContain('### Features');
    expect(output).not.toContain('### Breaking changes');
  });

  it('leaves earlier version blocks untouched', () => {
    const { output } = formatChangelog(changelog('- fix: A was wrong. ([#1](u))'));
    expect(output).toContain('## 0.9.0\n\nold stuff');
  });

  it('keeps a multi-line bullet together and indented', () => {
    const { output } = formatChangelog(
      changelog('- feat: **X.** First line here\n  and its continuation. ([#2](u))')
    );
    expect(output).toContain('- **X.** First line here\n  and its continuation. ([#2](u))');
  });

  it('preserves the PR link and author text it does not own', () => {
    const { output } = formatChangelog(
      changelog('- [#42](u) [`abc1234`](u) Thanks [@dotNacer](u)! - feat: **X.**')
    );
    expect(output).toContain('- [#42](u) [`abc1234`](u) Thanks [@dotNacer](u)! - **X.**');
  });

  it('is idempotent: a formatted block is left alone', () => {
    const formatted = changelog('### Fixes\n\n- A was wrong. ([#1](u))');
    const { output, errors, changed } = formatChangelog(formatted);
    expect(errors).toEqual([]);
    expect(changed).toBe(false);
    expect(output).toBe(formatted);
  });

  it('fails loudly on an untagged bullet among tagged ones', () => {
    const { errors, output } = formatChangelog(
      changelog('- feat: **X.** ([#1](u))\n- Updated dependencies [abc]:')
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('0 tags');
    expect(output).toContain('- feat:'); // nothing rewritten
  });

  it('fails loudly on a bullet carrying two tags', () => {
    const { errors } = formatChangelog(changelog('- feat: **X.** fix: also this. ([#1](u))'));
    expect(errors[0]).toContain('2 tags');
  });

  it('fails loudly with no version heading', () => {
    const { errors } = formatChangelog('# Changelog\n\nnothing here\n');
    expect(errors[0]).toContain('no `## <version>` heading');
  });

  it('fails loudly on a version block with no bullets', () => {
    const { errors } = formatChangelog('# Changelog\n\n## 0.10.0\n\n### Minor Changes\n');
    expect(errors[0]).toContain('no bullets');
  });

  it('preserves the trailing newline when the regrouped block is the last content in the file', () => {
    const { output, errors, changed } = formatChangelog(
      '# Changelog\n\n## 0.10.0\n\n- fix: A was wrong. ([#1](u))\n'
    );
    expect(errors).toEqual([]);
    expect(changed).toBe(true);
    expect(output).toBe('# Changelog\n\n## 0.10.0\n\n### Fixes\n\n- A was wrong. ([#1](u))\n');
  });
});
