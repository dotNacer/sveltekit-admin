import { describe, it, expect } from 'vitest';
import { createPrismaMock, callsTo, ENUMS_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Le `<select>` d'un enum ne propose que des valeurs déclarées, mais un POST
 * forgé n'est pas tenu de s'y conformer : la valeur est revalidée côté serveur,
 * comme l'est déjà toute cible de relation FK/m2m.
 */

const MEMBER = { id: 1, email: 'a@b.c', role: 'USER', tier: null };

function runtimeFor(prisma: any) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: ENUMS_SCHEMA_PATH });
  return createAdminRuntime({ adapter } as any);
}

const mutate = async (body: Record<string, string>, id = '1') => {
  const prisma = createPrismaMock({ member: [MEMBER] });
  const runtime = runtimeFor(prisma);
  const { event } = createEvent({ url: `/admin/member/${id}`, body });
  const formData = await event.request.formData();
  const result = handleMutation(runtime, event, { view: 'edit', model: 'member', id } as any, formData);
  return { prisma, result };
};

describe('revalidation serveur des enums', () => {
  it('refuse une valeur hors du domaine déclaré', async () => {
    const { result } = await mutate({ _action: 'update', email: 'a@b.c', role: 'SUPERUSER' });

    await expect(result).rejects.toMatchObject({
      constructor: AdminMutationError,
      kind: 'validation',
      field: 'role',
      message: 'role: invalid value'
    });
  });

  it('accepte une valeur déclarée', async () => {
    const { prisma, result } = await mutate({ _action: 'update', email: 'a@b.c', role: 'ADMIN' });
    await result;

    expect((callsTo(prisma, 'member', 'update')[0].args as any).data).toMatchObject({ role: 'ADMIN' });
  });

  it("écrit null quand l'option vide d'un enum nullable est soumise", async () => {
    // C'est ce que poste le `— aucun —` du widget. Sans cette conversion, la
    // colonne recevrait `''`, que le pilote refuse pour un type enum.
    const { prisma, result } = await mutate({ _action: 'update', email: 'a@b.c', tier: '' });
    await result;

    expect((callsTo(prisma, 'member', 'update')[0].args as any).data).toMatchObject({ tier: null });
  });

  it('refuse le vide sur un enum non nullable', async () => {
    const { result } = await mutate({ _action: 'update', email: 'a@b.c', role: '' });

    await expect(result).rejects.toMatchObject({
      kind: 'validation',
      field: 'role',
      message: 'role is required'
    });
  });

  it('ne touche pas aux scalaires ordinaires', async () => {
    const { prisma, result } = await mutate({ _action: 'update', email: 'neuf@x.y' });
    await result;

    expect((callsTo(prisma, 'member', 'update')[0].args as any).data).toMatchObject({ email: 'neuf@x.y' });
  });
});
