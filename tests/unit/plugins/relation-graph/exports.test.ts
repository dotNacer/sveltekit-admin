import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as root from '../../../../src/lib/index.js';
import { relationGraphPlugin } from '../../../../src/lib/server/plugins/relation-graph/index.js';

describe('sveltekit-admin/plugins/relation-graph', () => {
  it('exports relationGraphPlugin as a function', () => {
    expect(typeof relationGraphPlugin).toBe('function');
  });

  it('does not add a runtime export on the root entry', () => {
    expect(Object.keys(root)).not.toContain('relationGraphPlugin');
  });

  it('package.json exposes ./plugins/relation-graph', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./plugins/relation-graph']).toMatchObject({
      types: './dist/server/plugins/relation-graph/index.d.ts',
      svelte: './dist/server/plugins/relation-graph/index.js',
      default: './dist/server/plugins/relation-graph/index.js'
    });
  });

  it('root index.ts does not import the plugin', () => {
    const src = readFileSync(new URL('../../../../src/lib/index.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('relationGraphPlugin');
    expect(src).not.toContain('plugins/relation-graph');
  });
});
