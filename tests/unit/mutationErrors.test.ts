import { describe, it, expect } from 'vitest';
import { createPrismaMock, RELATIONS_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createEvent } from '../fixtures/events.js';

function runtimeFor(prisma: any, config: Record<string, unknown> = {}) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: RELATIONS_SCHEMA_PATH });
  return createAdminRuntime({ adapter, ...config } as any);
}

describe('handleMutation lève des AdminMutationError', () => {
  it('une FK inexistante donne kind=validation et le champ, message inchangé', async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [] });
    const runtime = runtimeFor(prisma);
    const { event } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '999' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any)
    ).rejects.toMatchObject({
      constructor: AdminMutationError,
      kind: 'validation',
      field: 'author',
      message: 'author: invalid value'
    });
  });

  it('un modèle inconnu donne kind=notFound, message inchangé', async () => {
    const prisma = createPrismaMock({ user: [] });
    const runtime = runtimeFor(prisma);
    const { event } = createEvent({ url: '/admin/nope/new', body: { _action: 'create' } });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'nope' } as any)
    ).rejects.toMatchObject({
      kind: 'notFound',
      message: 'Model "nope" not found'
    });
  });

  it('une valeur hors scope donne kind=authorization et le champ de scope', async () => {
    // L'utilisateur 2 DOIT exister : la boucle de validation FK tourne avant
    // l'imposition du scope, et rejetterait sinon la valeur en `validation`
    // — on ne testerait plus la branche visée.
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }], post: [], tag: [] });
    const runtime = runtimeFor(prisma, {
      models: { Post: { scope: () => ({ authorId: 1 }) } }
    });
    const { event } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '2' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any)
    ).rejects.toMatchObject({ kind: 'authorization', field: 'authorId' });
  });
});
