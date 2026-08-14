import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { PrismaClient } from '../fixtures/prisma/client/index.js';
import { createAdminHandler } from '../../src/lib/server/handler.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Couvre le seul chemin d'écriture réellement nouveau introduit par le
 * refactor DbAdapter : `createPrismaDataAdapter#createRecord`/`updateRecord`
 * (src/lib/server/adapters/prisma/dataAdapter.ts) enveloppent une écriture
 * m2m dans `prisma.$transaction(async (tx) => ...)` — une API Prisma Client
 * jamais appelée nulle part dans ce dépôt avant ce refactor. La seule
 * couverture existante de ce chemin passe par `tests/fixtures/prismaMock.ts`,
 * dont le `$transaction` est `(fn) => Promise.resolve(fn(mock))` : un mock
 * qui, par construction, ne peut jamais diverger du vrai comportement
 * transactionnel de Prisma. Ce fichier exerce donc le même chemin contre une
 * vraie base SQLite jetable (même mécanisme `prisma db push` que
 * `tests/integration/setup.ts`/`handler.db.test.ts`, sur le même schéma
 * étendu — voir tests/fixtures/prisma/schema.prisma#Post/Tag).
 *
 * Fichier volontairement séparé de `handler.db.test.ts` (protégé, diff nul
 * exigé) ; instancie son propre `PrismaClient`/handler comme le fait déjà ce
 * fichier protégé pour Widget/Doc.
 */
const prisma = new PrismaClient();
const SCHEMA = resolve('tests/fixtures/prisma/schema.prisma');
const handler = createAdminHandler({ prisma, prismaSchemaPath: SCHEMA });

const call = (url: string, body?: Record<string, string>) => {
  const { event, resolve: res } = createEvent({ url, body });
  return handler({ event, resolve: res });
};

beforeEach(async () => {
  // Les tables de jointure N-N implicites de Prisma sont nettoyées en
  // cascade par ces deleteMany : pas de table pivot à vider à la main.
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('handler sur une vraie base SQLite — écriture N-N (prisma.$transaction)', () => {
  it('création : les tags cochés sont réellement liés en base (connect, dans une vraie transaction)', async () => {
    const [js, ts] = await Promise.all([
      prisma.tag.create({ data: { name: 'js' } }),
      prisma.tag.create({ data: { name: 'ts' } })
    ]);
    await prisma.tag.create({ data: { name: 'unrelated' } });

    const res = await call('/admin/post/new', {
      _action: 'create',
      title: 'Real transaction post',
      __rel_present__tags: '1',
      __rel__tags: `${js.id},${ts.id}`
    });
    expect(res.status).toBe(303);

    const created = await prisma.post.findFirstOrThrow({
      where: { title: 'Real transaction post' },
      include: { tags: true }
    });
    expect(created.tags.map((t) => t.name).sort()).toEqual(['js', 'ts']);
  });

  it("mise à jour : le nouvel ensemble de tags remplace l'ancien en base (set, dans une vraie transaction)", async () => {
    const [js, ts, svelte] = await Promise.all([
      prisma.tag.create({ data: { name: 'js' } }),
      prisma.tag.create({ data: { name: 'ts' } }),
      prisma.tag.create({ data: { name: 'svelte' } })
    ]);
    const post = await prisma.post.create({
      data: { title: 'Original', tags: { connect: [{ id: js.id }, { id: ts.id }] } }
    });

    const res = await call(`/admin/post/${post.id}`, {
      _action: 'update',
      title: 'Original',
      __rel_present__tags: '1',
      __rel__tags: `${svelte.id}`
    });
    expect(res.status).toBe(303);

    const updated = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { tags: true }
    });
    // `set` remplace intégralement l'ensemble : ni js ni ts ne doivent
    // survivre, seul svelte doit rester lié.
    expect(updated.tags.map((t) => t.name)).toEqual(['svelte']);
  });
});
