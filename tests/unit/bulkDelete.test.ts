import { describe, it, expect, vi } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';

/**
 * Suppression en masse. L'opération la plus destructive de l'admin : elle doit
 * être atomique, bornée, scopée, et laisser une trace par ligne.
 */

const USERS = [
  { id: 1, email: 'a@b.c', name: 'A', role: 'USER' },
  { id: 2, email: 'c@d.e', name: 'B', role: 'USER' },
  { id: 3, email: 'e@f.g', name: 'C', role: 'ADMIN' }
];

const build = (config: Record<string, unknown> = {}, rows = USERS) => {
  const prisma = createPrismaMock({ user: rows, post: [], category: [] });
  return {
    prisma,
    handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any)
  };
};

const bulkDelete = async (ids: string[], config: Record<string, unknown> = {}) => {
  const { prisma, handler } = build(config);
  // `createEvent` sait répéter une clé (`ids=1&ids=3`), ce qu'envoie un groupe
  // de checkboxes — et il pose l'en-tête `Origin` qu'attend la garde CSRF.
  const { event, resolve } = createEvent({
    url: '/admin/user',
    body: { _action: 'bulk-delete', ids }
  });
  const response = await handler({ event, resolve } as any);
  return { prisma, response };
};

describe('suppression en masse', () => {
  it('supprime les lignes sélectionnées en une opération', async () => {
    const { prisma } = await bulkDelete(['1', '3']);

    const call = callsTo(prisma, 'user', 'deleteMany')[0];
    expect((call.args as any).where).toMatchObject({ id: { in: [1, 3] } });
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('redirige avec le nombre réellement supprimé', async () => {
    const { response } = await bulkDelete(['1', '3']);

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/admin/user?deleted=2');
  });

  it('refuse une sélection vide', async () => {
    const { prisma, response } = await bulkDelete([]);

    expect(callsTo(prisma, 'user', 'deleteMany')).toHaveLength(0);
    expect(response.status).toBe(422);
  });

  it('refuse une sélection au-delà du plafond', async () => {
    // L'interface ne peut sélectionner que ce qu'elle affiche : au-delà c'est
    // forgé, et un IN de 10 000 éléments est un vecteur de charge.
    const { prisma, response } = await bulkDelete(
      Array.from({ length: 201 }, (_, i) => String(i + 1))
    );

    expect(callsTo(prisma, 'user', 'deleteMany')).toHaveLength(0);
    expect(response.status).toBe(422);
  });

  it('ne supprime pas hors de la portée du modèle', async () => {
    const { prisma, response } = await bulkDelete(['1', '2', '3'], {
      models: { User: { scope: () => ({ role: 'USER' }) } }
    });

    const where = (callsTo(prisma, 'user', 'deleteMany')[0].args as any).where;
    expect(where.AND).toBeDefined();
    // Deux lignes sur trois sont dans la portée : le compte le dit, sans
    // distinguer « n'existe pas » de « appartient à quelqu'un d'autre ».
    expect(response.headers.get('Location')).toBe('/admin/user?deleted=2');
  });

  it('journalise une entrée d’audit par ligne supprimée', async () => {
    const audit = vi.fn();
    await bulkDelete(['1', '3'], { audit });

    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls.map(([entry]) => entry.id).sort()).toEqual([1, 3]);
    expect(audit.mock.calls[0][0].action).toBe('delete');
  });

  it('ne journalise que les lignes en portée', async () => {
    // L'instantané d'audit est lu avec la MÊME portée que la suppression :
    // sans ça, le journal contiendrait les lignes d'un autre tenant que
    // l'opération n'a pas touchées.
    const audit = vi.fn();
    await bulkDelete(['1', '2', '3'], {
      audit,
      models: { User: { scope: () => ({ role: 'USER' }) } }
    });

    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls.map(([entry]) => entry.id).sort()).toEqual([1, 2]);
  });

  it('ne lit rien de plus quand aucun audit n’est configuré', async () => {
    const { prisma } = await bulkDelete(['1']);

    expect(callsTo(prisma, 'user', 'findMany')).toHaveLength(0);
  });

  it('rend une contrainte FK comme telle, sans rien supprimer', async () => {
    // `reference` et `restrict` partagent le même code SQLSTATE : c'est
    // l'action en cours qui les sépare, et seul ce site d'appel la connaît.
    const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
    prisma.user.deleteMany = () => {
      throw Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user',
      body: { _action: 'bulk-delete', ids: ['1'] }
    });

    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('This record is referenced by other records.');
  });

  it('masque un code pilote inconnu derrière un message générique', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ user: USERS, post: [], category: [] });
    prisma.user.deleteMany = () => {
      throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const { event, resolve } = createEvent({
      url: '/admin/user',
      body: { _action: 'bulk-delete', ids: ['1'] }
    });

    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).not.toContain('connection terminated');
    expect(html).toContain('The change could not be saved.');
    expect(error).toHaveBeenCalled();
  });

  it('laisse la suppression unitaire intacte', async () => {
    const { prisma, handler } = build();
    const { event, resolve } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'delete' }
    });
    await handler({ event, resolve } as any);

    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(1);
    expect(callsTo(prisma, 'user', 'deleteMany')).toHaveLength(0);
  });
});
