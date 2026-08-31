import { describe, it, expect } from 'vitest';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createEvent } from '../fixtures/events.js';

/**
 * « Vide » veut dire deux choses qu'on ne doit jamais confondre : un champ
 * ABSENT du POST (readonly, masqué, colonne à défaut non rendue) n'est pas
 * soumis, un champ PRÉSENT et vide est une saisie. Le premier n'écrit rien, le
 * second écrit `null` — ou est refusé si la colonne n'accepte pas NULL.
 */

const USER = { id: 1, email: 'a@b.c', password: 'h', name: 'N', role: 'USER' };

function runtimeFor(prisma: any, config: Record<string, unknown> = {}) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return createAdminRuntime({ adapter, ...config } as any);
}

const update = async (body: Record<string, string>, config: Record<string, unknown> = {}) => {
  const prisma = createPrismaMock({ user: [USER], post: [], category: [] });
  const runtime = runtimeFor(prisma, config);
  const { event } = createEvent({ url: '/admin/user/1', body: { _action: 'update', ...body } });
  const formData = await event.request.formData();
  return {
    prisma,
    result: handleMutation(runtime, event, { view: 'edit', model: 'user', id: '1' } as any, formData)
  };
};

describe('colonne qui n’accepte pas NULL', () => {
  it('refuse un String obligatoire vidé', async () => {
    const { result } = await update({ email: '' });

    await expect(result).rejects.toMatchObject({
      constructor: AdminMutationError,
      kind: 'validation',
      field: 'email',
      message: 'email is required'
    });
  });

  it('refuse un numérique obligatoire vidé', async () => {
    // Partait en `null` jusqu'au pilote, qui répondait par un message générique
    // ne nommant aucun champ.
    const { result } = await update({ email: 'a@b.c', visits: '' });

    await expect(result).rejects.toMatchObject({ kind: 'validation', field: 'visits' });
  });

  it('ne refuse pas un champ obligatoire absent du POST', async () => {
    const { prisma, result } = await update({ name: 'Neuf' });
    await result;

    const data = (callsTo(prisma, 'user', 'update')[0].args as any).data;
    expect('email' in data).toBe(false);
    expect(data.name).toBe('Neuf');
  });
});

describe('colonne nullable', () => {
  it('écrit null quand elle est vidée', async () => {
    const { prisma, result } = await update({ email: 'a@b.c', name: '' });
    await result;

    expect((callsTo(prisma, 'user', 'update')[0].args as any).data.name).toBeNull();
  });
});

describe('interaction avec les autres boucles d’écriture', () => {
  it('laisse la boucle FK nommer la relation, jamais son scalaire', async () => {
    // Garde-fou : un contrôle générique placé avant la boucle FK dégraderait
    // « author is required » en « authorId is required ».
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma);
    const { event } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any, await event.request.formData())
    ).rejects.toMatchObject({ field: 'author', message: 'author is required' });
  });

  it('crée encore quand la colonne obligatoire vide est imposée par le scope', async () => {
    // `mutations.ts` documente que le formulaire de création rend la colonne de
    // tenant vide : la refuser rendrait le modèle incréable dès qu'elle est
    // visible. Le contrôle tourne donc après l'imposition du scope.
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      models: { User: { scope: () => ({ email: 'tenant@x.y' }) } }
    } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: '', password: 'p' }
    });

    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data.email).toBe('tenant@x.y');
  });

  it('crée encore quand la colonne enum obligatoire vide est imposée par le scope', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      models: { User: { scope: () => ({ role: 'ADMIN' }) } }
    } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p', role: '' }
    });

    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data.role).toBe('ADMIN');
  });
});
