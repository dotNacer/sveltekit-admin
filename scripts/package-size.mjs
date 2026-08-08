#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { statSync, unlinkSync } from 'node:fs';

const UNIT_BYTES = { B: 1, KB: 1024, MB: 1024 * 1024 };

function parsePackedLine(line) {
  const match = line.match(/^packed\s+([\d.]+)(B|KB|MB)\s+(.+)$/);
  if (!match) return null;
  const [, size, unit, path] = match;
  return { path, bytes: parseFloat(size) * UNIT_BYTES[unit] };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes.toFixed(0)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function categorize(path) {
  if (path.endsWith('.d.ts')) return 'Type declarations (.d.ts) — poids nul à l\'exécution';
  if (path.endsWith('.js') || path.endsWith('.svelte')) return 'Runtime code (.js/.svelte)';
  return 'Other (metadata)';
}

const output = execSync('bun pm pack --dry-run', { encoding: 'utf-8' });
const files = output
  .split('\n')
  .map(parsePackedLine)
  .filter(Boolean);

if (files.length === 0) {
  console.error('No packed files found — is `bun pm pack --dry-run` producing the expected output?');
  process.exit(1);
}

const total = files.reduce((sum, f) => sum + f.bytes, 0);

// `--dry-run` never writes a tarball, so it can't report the real gzip size a
// consumer actually downloads via `npm install`. Pack for real (in the project
// root — `--destination` hangs indefinitely on this bun version), measure it,
// then delete it immediately: this script never leaves a .tgz behind.
const packedFilename = execSync('bun pm pack --quiet', { encoding: 'utf-8' }).trim();
const packedBytes = statSync(packedFilename).size;
unlinkSync(packedFilename);

const buckets = new Map();
for (const file of files) {
  const key = categorize(file.path);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(file);
}

console.log(
  `\nPackage breakdown (${files.length} files, ${formatBytes(total)} unpacked, ${formatBytes(packedBytes)} packed/gzip — this is what \`npm install\` actually downloads)\n`
);

// Runtime code first, then type declarations, then anything else — biggest
// contributor to what a consumer actually executes goes on top.
const order = [
  'Runtime code (.js/.svelte)',
  "Type declarations (.d.ts) — poids nul à l'exécution",
  'Other (metadata)'
];

for (const key of order) {
  const bucket = buckets.get(key);
  if (!bucket) continue;
  const bucketTotal = bucket.reduce((sum, f) => sum + f.bytes, 0);
  const bucketPct = ((bucketTotal / total) * 100).toFixed(1);
  console.log(`  ${key} — ${formatBytes(bucketTotal)} (${bucketPct}%)`);
  bucket
    .sort((a, b) => b.bytes - a.bytes)
    .forEach((f) => {
      const pct = ((f.bytes / total) * 100).toFixed(1).padStart(4);
      console.log(`   ${formatBytes(f.bytes).padStart(8)} (${pct}%)  ${f.path}`);
    });
  console.log('');
}
