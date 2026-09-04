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
  validateChangeset
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
