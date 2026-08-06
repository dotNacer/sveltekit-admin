import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCHEMA = resolve('tests/fixtures/prisma/schema.prisma');
const PRISMA = resolve('node_modules/.bin/prisma');

let dir: string;

/**
 * globalSetup Vitest : crée une base SQLite jetable et y pousse le schéma
 * d'intégration. `TEST_DATABASE_URL` est lu par le datasource du schéma et
 * hérité par les workers de test, qui y branchent leur PrismaClient.
 */
export function setup() {
  dir = mkdtempSync(join(tmpdir(), 'ska-test-'));
  process.env.TEST_DATABASE_URL = `file:${join(dir, 'test.db')}`;

  // La base est neuve à chaque run : pas besoin de `--force-reset`.
  // stdio 'pipe' garde la sortie de la suite propre ; on ne parle qu'en cas d'échec.
  try {
    execFileSync(PRISMA, ['db', 'push', '--schema', SCHEMA, '--skip-generate'], {
      stdio: 'pipe',
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }
    });
  } catch (e: any) {
    throw new Error(
      `prisma db push a échoué :\n${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`
    );
  }
}

export function teardown() {
  rmSync(dir, { recursive: true, force: true });
}
