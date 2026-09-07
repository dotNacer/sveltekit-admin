import { describe, it, expect, vi } from 'vitest';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Write-transform hook (issue #25) : `models.<Model>.transform` transforme
 * une valeur soumise juste avant l'écriture, par champ — typiquement pour
 * hasher un mot de passe. Testé ici au niveau `handleMutation` (ORM-agnostic),
 * la parité Prisma/Drizzle étant garantie par le fait que ce fichier n'a
 * aucune dépendance à un adapter — voir `tests/integration/writeTransform.drizzle.db.test.ts`
 * pour la preuve avec un vrai adapter Drizzle.
 */

function runtimeFor(prisma: any, config: Record<string, unknown> = {}) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
  return createAdminRuntime({ adapter, ...config } as any);
}

const bodyOf = (event: { request: Request }) => event.request.formData();

describe('write-transform hook — cas simple', () => {
  it('transforme une valeur synchrone avant écriture (create)', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: { User: { transform: { password: (raw: string) => `hashed:${raw}` } } }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'plain123' }
    });

    await handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event));

    expect((callsTo(prisma, 'user', 'create')[0].args as any).data).toMatchObject({
      password: 'hashed:plain123'
    });
  });

  it('attend un transform async avant l’écriture', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          transform: {
            password: async (raw: string) => {
              await new Promise((resolve) => setTimeout(resolve, 1));
              return `async:${raw}`;
            }
          }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'plain123' }
    });

    await handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event));

    expect((callsTo(prisma, 'user', 'create')[0].args as any).data).toMatchObject({
      password: 'async:plain123'
    });
  });

  it('transmet `{ locals }` au transform', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          transform: {
            password: (raw: string, ctx: { locals?: any }) => `${ctx.locals?.actor}:${raw}`
          }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'plain123' },
      locals: { actor: 'admin1' }
    });

    await handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event));

    expect((callsTo(prisma, 'user', 'create')[0].args as any).data).toMatchObject({
      password: 'admin1:plain123'
    });
  });

  it('n’applique pas le transform à un champ absent du payload soumis', async () => {
    // `bio` est String? : non soumis, `formDataToPrisma` n'écrit pas la clé.
    // Le transform ne doit jamais être appelé sur un champ qu'il n'y a rien à
    // transformer — readonly, masqué, ou simplement non rempli.
    const bioTransform = vi.fn((raw: string) => raw.toUpperCase());
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: { User: { transform: { bio: bioTransform } } }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'p' }
    });

    await handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event));

    expect(bioTransform).not.toHaveBeenCalled();
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data).not.toHaveProperty('bio');
  });

  it('applique aussi le transform sur update, pour un champ non sensible', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c', name: 'ada' }], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: { User: { transform: { name: (raw: string) => raw.toUpperCase() } } }
    });
    const { event } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'a@b.c', name: 'ada' }
    });

    await handleMutation(runtime, event, { view: 'edit', model: 'user', id: '1' } as any, await bodyOf(event));

    expect((callsTo(prisma, 'user', 'update')[0].args as any).data).toMatchObject({ name: 'ADA' });
  });

  it('un transform configuré sur `password` ne tourne jamais à l’édition, la colonne sensible étant déjà retirée du payload', async () => {
    const passwordTransform = vi.fn((raw: string) => `should-not-run:${raw}`);
    const prisma = createPrismaMock({
      user: [{ id: 1, email: 'a@b.c', password: '$2b$10$hash' }],
      post: [],
      category: []
    });
    const runtime = runtimeFor(prisma, {
      models: { User: { transform: { password: passwordTransform } } }
    });
    const { event } = createEvent({
      url: '/admin/user/1',
      // Le champ sensible n'est plus rendu par le formulaire d'édition :
      // une valeur soumise quand même (POST forgé) est déjà retirée du
      // payload avant que le transform ne puisse la voir.
      body: { _action: 'update', email: 'a@b.c', password: 'injecte' }
    });

    await handleMutation(runtime, event, { view: 'edit', model: 'user', id: '1' } as any, await bodyOf(event));

    expect(passwordTransform).not.toHaveBeenCalled();
    expect((callsTo(prisma, 'user', 'update')[0].args as any).data).not.toHaveProperty('password');
  });
});

describe('write-transform hook — erreurs', () => {
  it('un throw Error() devient une AdminMutationError(validation) nommant le champ', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          transform: {
            password: () => {
              throw new Error('too weak');
            }
          }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'weak' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event))
    ).rejects.toMatchObject({
      constructor: AdminMutationError,
      kind: 'validation',
      field: 'password',
      message: 'password: too weak'
    });
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(0);
  });

  it('un throw async devient aussi une AdminMutationError(validation)', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          transform: {
            password: async () => {
              throw new Error('hash backend unavailable');
            }
          }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'p' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event))
    ).rejects.toMatchObject({ kind: 'validation', field: 'password' });
  });

  it('un throw d’une valeur non-Error est quand même rapporté (String(e))', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          transform: {
            password: () => {
              throw 'nope';
            }
          }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'p' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event))
    ).rejects.toMatchObject({ kind: 'validation', field: 'password', message: 'password: nope' });
  });

  it('ne masque jamais l’erreur derrière un message pilote générique', async () => {
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const { createAdminHandler } = await import('../../src/lib/server/adapters/prisma/handler.js');
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: FULL_SCHEMA_PATH,
      models: {
        User: {
          transform: {
            password: () => {
              throw new Error('too weak');
            }
          }
        }
      }
    } as any);
    const ev = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c', password: 'weak' }
    });

    const html = await (await handler(ev as any)).text();

    expect(html).toContain('password: too weak');
  });
});

describe('write-transform hook — colonne de scope', () => {
  it('ignore un transform configuré sur une colonne de scope', async () => {
    // `email` est ici la colonne de scope (tenant) : un transform configuré
    // dessus ne doit jamais tourner, la valeur étant imposée par le serveur
    // et non une saisie — voir le double-garde documenté dans mutations.ts.
    const emailTransform = vi.fn((raw: string) => raw.toUpperCase());
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          scope: () => ({ email: 'tenant@x.y' }),
          transform: { email: emailTransform }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'tenant@x.y', password: 'p' }
    });

    await handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event));

    expect(emailTransform).not.toHaveBeenCalled();
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data).toMatchObject({
      email: 'tenant@x.y'
    });
  });

  it('refuse toujours une valeur hors scope, même avec un transform configuré sur ce champ', async () => {
    const emailTransform = vi.fn((raw: string) => raw.toUpperCase());
    const prisma = createPrismaMock({ user: [], post: [], category: [] });
    const runtime = runtimeFor(prisma, {
      models: {
        User: {
          scope: () => ({ email: 'tenant@x.y' }),
          transform: { email: emailTransform }
        }
      }
    });
    const { event } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'autre-tenant@x.y', password: 'p' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'user' } as any, await bodyOf(event))
    ).rejects.toMatchObject({ kind: 'authorization', field: 'email' });
    expect(emailTransform).not.toHaveBeenCalled();
  });
});
