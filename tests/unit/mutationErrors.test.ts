import { describe, it, expect, vi } from 'vitest';
import { createPrismaMock, RELATIONS_SCHEMA_PATH, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createEvent } from '../fixtures/events.js';

/**
 * `handleMutation` reçoit le corps déjà lu — c'est le handler qui le lit, pour
 * pouvoir re-rendre le formulaire avec les valeurs soumises quand ça échoue.
 */
const bodyOf = (event: { request: Request }) => event.request.formData();

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
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any, await bodyOf(event))
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
      handleMutation(runtime, event, { view: 'create', model: 'nope' } as any, await bodyOf(event))
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
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any, await bodyOf(event))
    ).rejects.toMatchObject({ kind: 'authorization', field: 'authorId' });
  });
});

describe('rendu des erreurs de mutation', () => {
  const GENERIC = 'The change could not be saved.';

  it('ne rend jamais le message d’une erreur pilote', async () => {
    const leak =
      'Invalid `prisma.user.create()` invocation: Unique constraint failed on the fields: (`email`)';
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c' }] });
    prisma.user.create = () => {
      throw Object.assign(new Error(leak), { code: 'P2002' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c' }
    });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('prisma.user.create');
    expect(html).not.toContain('Unique constraint failed');
    expect(html).toContain('A record with these values already exists.');
  });

  it('rend un texte générique sur un code pilote inconnu, et journalise l’original', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ user: [] });
    prisma.user.create = () => {
      throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/user/new', body: { _action: 'create', email: 'x@y.z' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('connection terminated');
    expect(html).toContain(GENERIC);
    expect(err).toHaveBeenCalled();
  });

  it('rend un texte générique sur un code pilote inconnu levé par la mise à jour', async () => {
    // Couvre le fallback `?? e` du site d'appel `updateRecord` : un code non
    // reconnu par `classifyWriteError` doit relayer l'erreur d'origine, que
    // ce `catch` partagé masque ensuite (comportement inchangé).
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c' }] });
    prisma.user.update = () => {
      throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/user/1', body: { _action: 'update', email: 'x@y.z' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('connection terminated');
    expect(html).toContain(GENERIC);
    expect(err).toHaveBeenCalled();
  });

  it('rend un texte générique sur un code pilote inconnu levé par la suppression', async () => {
    // Couvre le fallback `?? e` du site d'appel `deleteRecord`, symétrique
    // du cas update ci-dessus.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ tag: [{ id: 1, name: 'x' }] });
    prisma.tag.delete = () => {
      throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/tag/1', body: { _action: 'delete' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('connection terminated');
    expect(html).toContain(GENERIC);
    expect(err).toHaveBeenCalled();
  });

  it('rend le message d’une AdminMutationError de validation, inchangé', async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH
    } as any);
    const ev = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '999' }
    });

    expect(await (await handler(ev as any)).text()).toContain('author: invalid value');
  });

  it('rend "referenced by other records" (restrict) sur une suppression bloquée par une FK, jamais "reference"', async () => {
    // Couvre la branche `restrict` de `classifyWriteError` : `reference` et
    // `restrict` partagent le même code SQLSTATE (P2003 / 23503), seule
    // l'action en cours les distingue. Cette classification se fait dans
    // `mutations.ts`, au site d'appel de `deleteRecord`, qui est le seul à
    // savoir laquelle des deux actions est en cours.
    const prisma = createPrismaMock({ tag: [{ id: 1, name: 'x' }] });
    prisma.tag.delete = () => {
      throw Object.assign(new Error('Foreign key constraint failed on the field: `posts`'), {
        code: 'P2003'
      });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: RELATIONS_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/tag/1', body: { _action: 'delete' } });

    const html = await (await handler(ev as any)).text();

    expect(html).toContain('This record is referenced by other records.');
    expect(html).not.toContain('A referenced record no longer exists.');
  });

  it('classe aussi un code pilote levé par la mise à jour (kind=conflict)', async () => {
    // Couvre le site d'appel `updateRecord` de `mutations.ts`, distinct de
    // celui de `createRecord` et `deleteRecord` : les trois sites classent
    // désormais indépendamment, chacun avec sa propre action.
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c' }] });
    prisma.user.update = () => {
      throw Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
        code: 'P2002'
      });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/user/1', body: { _action: 'update', email: 'taken@b.c' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('Unique constraint failed');
    expect(html).toContain('A record with these values already exists.');
  });

  it('masque aussi une erreur sans code pilote (PrismaClientValidationError)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // PrismaClientValidationError n'a pas de `.code` — seule
    // PrismaClientKnownRequestError en porte un — mais son message contient
    // l'appel complet et le dump des arguments soumis. Sans code pilote,
    // rien ne doit distinguer ce cas d'un autre bug moteur : par défaut, on
    // masque toujours, sauf `AdminMutationError` reconnue.
    const dump =
      'Invalid `prisma.user.create()` invocation in\n' +
      '/app/src/lib/server/data.ts:42:34\n\n' +
      '  39 await prisma.user.create({\n' +
      '  40   data: {\n' +
      '  41     email: "a@b.c",\n' +
      '→ 42     name: undefined\n' +
      '  })\n\n' +
      'Argument `name` is missing.';
    const prisma = createPrismaMock({ user: [] });
    prisma.user.create = () => {
      throw new Error(dump);
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/user/new', body: { _action: 'create', email: 'a@b.c' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('prisma.user.create');
    expect(html).not.toContain('Argument `name` is missing');
    expect(html).toContain(GENERIC);
  });
});
