import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH, PIVOT_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';

const USERS = [{ id: 1, email: 'a@b.c', password: 'x' }];

function build(
  config: Record<string, unknown> = {},
  prisma = createPrismaMock({ user: USERS, post: [], category: [] })
) {
  return {
    handler: createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH, ...config } as any),
    prisma
  };
}

afterEach(() => vi.restoreAllMocks());

describe('createAdminHandler — config.adapter explicite', () => {
  it('accepte un adapter fourni directement, sans prismaSchemaPath', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });
    const h = createAdminHandler({ adapter } as any);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(html).toContain('a@x.y');
  });

  it('avertit et dégrade proprement si introspect() renvoie une Promise (introspecteur async non supporté)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const asyncIntrospector = { introspect: () => Promise.resolve({ models: [], enums: [], provider: 'postgresql' }) };
    const h = createAdminHandler({
      adapter: { introspector: asyncIntrospector, data: {} as any }
    } as any);
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await h({ event, resolve } as any)).text();
    expect(warn).toHaveBeenCalled();
    // Même dégradation que pour un schéma illisible : aucun modèle connu.
    expect(html).not.toContain('href="/admin/user"');
  });
});

describe('périmètre du handler', () => {
  it('délègue à resolve hors du basePath', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/public' });
    const res = await handler({ event, resolve } as any);
    expect(resolve.called).toBe(true);
    expect(await res.text()).toBe('resolved-by-sveltekit');
  });

  it('respecte un basePath personnalisé', async () => {
    const { handler } = build({ basePath: '/back' });
    const { event, resolve } = createEvent({ url: '/back' });
    await handler({ event, resolve } as any);
    expect(resolve.called).toBe(false);
  });

  it('utilise le basePath personnalisé dans les liens et les redirections', async () => {
    const { handler } = build({ basePath: '/back' });
    const list = createEvent({ url: '/back' });
    expect(await (await handler(list as any)).text()).toContain('href="/back/user"');

    const post = createEvent({ url: '/back/user/1', body: { _action: 'delete' } });
    const res = await handler(post as any);
    expect(res.headers.get('Location')).toBe('/back/user');
  });
});

describe('authCheck', () => {
  it('renvoie 401 quand la vérification échoue', async () => {
    const { handler, prisma } = build({ authCheck: () => false });
    const { event, resolve } = createEvent({ url: '/admin' });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Unauthorized');
    expect(prisma.calls).toHaveLength(0);
  });

  it('bloque aussi les POST quand la vérification échoue', async () => {
    const { handler, prisma } = build({ authCheck: () => false });
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    expect((await handler({ event, resolve } as any)).status).toBe(401);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });

  it('accepte une vérification asynchrone', async () => {
    const { handler } = build({ authCheck: async () => true });
    const { event, resolve } = createEvent({ url: '/admin' });
    expect((await handler({ event, resolve } as any)).status).toBe(200);
  });

  it('laisse passer sans authCheck', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin' });
    expect((await handler({ event, resolve } as any)).status).toBe(200);
  });

  it('reçoit l’event complet', async () => {
    const seen: unknown[] = [];
    const { handler } = build({
      authCheck: (e: unknown) => {
        seen.push(e);
        return true;
      }
    });
    const { event, resolve } = createEvent({ url: '/admin', locals: { user: { id: 7 } } });
    await handler({ event, resolve } as any);
    expect((seen[0] as any).locals.user.id).toBe(7);
  });
});

describe('réponses GET', () => {
  it('renvoie du HTML typé', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin' });
    const res = await handler({ event, resolve } as any);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('compte chaque modèle pour le dashboard', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin' });
    await handler({ event, resolve } as any);
    expect(callsTo(prisma, 'user', 'count')).toHaveLength(1);
    expect(callsTo(prisma, 'category', 'count')).toHaveLength(1);
  });

  it('affiche zéro quand le comptage échoue', async () => {
    const prisma = createPrismaMock(
      { user: USERS, post: [], category: [] },
      {
        user: {
          count: () => {
            throw new Error('no table');
          }
        }
      }
    );
    const { handler } = build({}, prisma);
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('0 records');
    // le total retombe à 0 : l'erreur de comptage est avalée, pas propagée
    expect(html).toContain('<div class="ska-stat__value">0</div>');
    expect(html).not.toContain('<div class="ska-alert ska-alert--error">');
  });

  it('exclut les modèles listés dans exclude', async () => {
    const { handler } = build({ exclude: ['Post'] });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).not.toContain('href="/admin/post"');
  });

  it('traite un modèle exclu comme inconnu', async () => {
    const { handler } = build({ exclude: ['Post'] });
    const { event, resolve } = createEvent({ url: '/admin/post' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('not found');
  });

  it('lit le paramètre page', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user?page=3' });
    await handler({ event, resolve } as any);
    expect((callsTo(prisma, 'user', 'findMany')[0].args as any).skip).toBe(40);
  });

  it('rend le formulaire de création sur /new', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/new' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('value="create"');
    expect(prisma.calls).toHaveLength(0);
  });

  it('rend le formulaire d’édition avec l’enregistrement', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/1' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('value="update"');
    expect(html).toContain('a@b.c');
    expect(callsTo(prisma, 'user', 'findUnique')).toHaveLength(1);
  });

  it('affiche not found sur un id absent', async () => {
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/999' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('User with ID "999" not found');
  });

  it('rend not found sur une URL trop profonde', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/1/edit' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('Page not found');
    // ni dashboard ni liste : aucune requête ne part vers Prisma
    expect(prisma.calls).toHaveLength(0);
  });

  it('applique le label configuré du modèle', async () => {
    const { handler } = build({ models: { User: { label: 'Comptes' } } });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('Comptes');
  });
});

describe('actions POST', () => {
  it('crée puis redirige en 303', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'n@x.y', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/user');
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(1);
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data.email).toBe('n@x.y');
  });

  it('refuse une création dont le champ scoped est forgé', async () => {
    // Le rejet vaut pour toute colonne de scope, pas seulement les scalaires de
    // relation : une valeur soumise divergente est soit un POST forgé, soit un
    // formulaire qui offre un choix qu'il ne devrait pas offrir.
    const { handler, prisma } = build({
      models: { User: { scope: () => ({ email: 'tenant-a@example.test' }) } }
    });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'attacker@example.test', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/outside the authorization scope/);
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(0);
  });

  it('impose le champ scoped absent du formulaire', async () => {
    // Champ non soumis (caché ou readonly) : rien à confronter, la valeur du
    // scope est simplement posée.
    const { handler, prisma } = build({
      models: { User: { scope: () => ({ email: 'tenant-a@example.test' }), hidden: ['email'] } }
    });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', password: 'p' }
    });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect((callsTo(prisma, 'user', 'create')[0].args as any).data.email).toBe('tenant-a@example.test');
  });

  it('refuse une création scoped si le scope est un filtre non injectible', async () => {
    const { handler, prisma } = build({
      models: { User: { scope: () => ({ op: 'or', clauses: [
        { op: 'eq', field: 'email', value: 'a@example.test' },
        { op: 'eq', field: 'email', value: 'b@example.test' }
      ] }) } }
    });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'attacker@example.test', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/only equality conditions|scope/);
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(0);
  });

  it('refuse une création scoped sans tenant exploitable', async () => {
    const { handler, prisma } = build({
      models: { User: { scope: ({ locals }: any) => ({ email: locals.tenantEmail }) } }
    });
    const { event, resolve } = createEvent({
      url: '/admin/user/new',
      locals: {},
      body: { _action: 'create', email: 'attacker@example.test', password: 'p' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/scope/);
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(0);
  });

  it('compose scope et listWhere sur la liste sans écrasement', async () => {
    const { handler, prisma } = build({
      models: { User: {
        scope: () => ({ email: 'tenant@example.test' }),
        listWhere: () => ({ role: 'ADMIN' })
      } }
    });
    const { event, resolve } = createEvent({ url: '/admin/user' });
    await handler({ event, resolve } as any);
    const where = (callsTo(prisma, 'user', 'findMany')[0].args as any).where;
    expect(where.AND).toHaveLength(2);
  });

  it('met à jour puis redirige', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({
      url: '/admin/user/1',
      body: { _action: 'update', email: 'u@x.y' }
    });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect(callsTo(prisma, 'user', 'update')).toHaveLength(1);
    expect((callsTo(prisma, 'user', 'update')[0].args as any).where).toEqual({ id: 1 });
  });

  it('supprime puis redirige', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    expect((await handler({ event, resolve } as any)).status).toBe(303);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(1);
    expect((callsTo(prisma, 'user', 'delete')[0].args as any).where).toEqual({ id: 1 });
  });

  it('refuse une édition hors scope sans appeler update', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'other@x.y', tenantId: 'tenant-b' }] });
    const { handler } = build({
      models: { User: { scope: () => ({ tenantId: 'tenant-a' }) } }
    }, prisma);
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'update', email: 'x@y.z' } });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('User with ID "1" not found');
    expect(callsTo(prisma, 'user', 'update')).toHaveLength(0);
  });

  it('refuse une suppression hors scope sans appeler delete', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'other@x.y', tenantId: 'tenant-b' }] });
    const { handler } = build({
      models: { User: { scope: () => ({ tenantId: 'tenant-a' }) } }
    }, prisma);
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('User with ID "1" not found');
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
  });
  it('retombe sur le rendu sans _action reconnue', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'wat' } });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(callsTo(prisma, 'user', 'update')).toHaveLength(0);
    // l'action non reconnue retombe sur le rendu GET : c'est le formulaire d'édition
    const html = await res.text();
    expect(html).toContain('value="update"');
    expect(html).toContain('a@b.c');
  });

  it('retombe sur la liste pour un delete sans id', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin/user', body: { _action: 'delete' } });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(callsTo(prisma, 'user', 'delete')).toHaveLength(0);
    expect(callsTo(prisma, 'user', 'findMany')).toHaveLength(1);
  });

  it('ignore un POST sur le dashboard', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({ url: '/admin', body: { _action: 'create' } });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(200);
    expect(callsTo(prisma, 'user', 'create')).toHaveLength(0);
  });

  // Comportement d'origine, vérifié dans le code d'avant refactor : le `return` du 303
  // se trouve APRÈS le `if (create) … else if (route.id) …`, donc un `update` sans id
  // n'écrit rien mais redirige comme si l'opération avait réussi. Documenté ici tel
  // quel, pas corrigé — seul un POST direct sur /admin/<model> atteint cet état.
  it('redirige sans rien écrire sur un update sans id', async () => {
    const { handler, prisma } = build();
    const { event, resolve } = createEvent({
      url: '/admin/user',
      body: { _action: 'update', email: 'x@y.z' }
    });
    const res = await handler({ event, resolve } as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin/user');
    expect(callsTo(prisma, 'user', 'update')).toHaveLength(0);
  });

  it('rend une alerte sur modèle inconnu en POST', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = build();
    const { event, resolve } = createEvent({ url: '/admin/nope', body: { _action: 'create' } });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('<div class="ska-alert ska-alert--error">Error: Model &quot;nope&quot; not found</div>');
  });
});

describe('gestion des erreurs', () => {
  it('rend l’erreur Prisma échappée', async () => {
    const prisma = createPrismaMock(
      { user: USERS },
      {
        user: {
          findMany: () => {
            throw new Error('boom <b>');
          }
        }
      }
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = build({}, prisma);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('boom &lt;b&gt;');
  });

  it('rend un message générique sans message d’erreur', async () => {
    const prisma = createPrismaMock(
      { user: USERS },
      {
        user: {
          findMany: () => {
            throw {};
          }
        }
      }
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = build({}, prisma);
    const { event, resolve } = createEvent({ url: '/admin/user' });
    expect(await (await handler({ event, resolve } as any)).text()).toContain('Unknown error');
  });
});

describe('hidePivotTables', () => {
  it('masque les pivot tables par défaut', async () => {
    const prisma = createPrismaMock({ user: [], team: [], userTeam: [], _RoleToUser: [] });
    const handler = createAdminHandler({ prisma, prismaSchemaPath: PIVOT_SCHEMA_PATH });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    // Les modèles normaux sont visibles
    expect(html).toContain('User');
    expect(html).toContain('Team');
    // Les pivot tables sont masquées (UserTeam et _RoleToUser)
    expect(html).not.toContain('User Team');
    expect(html).not.toContain('UserTeam');
    expect(html).not.toContain('_RoleToUser');
    expect(html).not.toContain('Role To User');
  });

  it('affiche les pivot tables avec hidePivotTables: false', async () => {
    const prisma = createPrismaMock({ user: [], team: [], userTeam: [], _RoleToUser: [] });
    const handler = createAdminHandler({ prisma, prismaSchemaPath: PIVOT_SCHEMA_PATH, hidePivotTables: false });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    // Les pivot tables sont visibles
    expect(html).toContain('User Team');
  });
});

describe('scope portant sur un scalaire de relation', () => {
  // Les autres tests de scope utilisent `email`/`tenantId`, des colonnes
  // ordinaires. Or la colonne de tenant est presque toujours un scalaire de
  // relation (`organizationId`, `authorId`…), et la boucle de revalidation
  // des FK réécrit `data[scalarName]` avec la valeur soumise — ce qui écrasait
  // la valeur forcée par le scope.
  const twoTenants = () =>
    createPrismaMock({
      user: [
        { id: 1, email: 'a@x.y', password: 'p' },
        { id: 2, email: 'b@x.y', password: 'p' }
      ],
      post: [{ id: 'p1', title: 'mine', authorId: 1, published: false }],
      category: []
    });

  it("refuse une création qui tente d'écrire dans un autre tenant", async () => {
    const prisma = twoTenants();
    const { handler } = build({ models: { Post: { scope: () => ({ authorId: 1 }) } } }, prisma);
    const { event, resolve } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'hi', authorId: '2' }
    });

    const res = await handler({ event, resolve } as any);

    expect(callsTo(prisma, 'post', 'create')).toHaveLength(0);
    expect(await res.text()).toContain('authorId');
  });

  it('force la valeur du scope quand la création soumet le bon tenant', async () => {
    const prisma = twoTenants();
    const { handler } = build({ models: { Post: { scope: () => ({ authorId: 1 }) } } }, prisma);
    const { event, resolve } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'hi', authorId: '1' }
    });

    await handler({ event, resolve } as any);

    const created = callsTo(prisma, 'post', 'create');
    expect(created).toHaveLength(1);
    expect((created[0].args as any).data.authorId).toBe(1);
  });

  it("refuse une édition qui déplacerait l'enregistrement vers un autre tenant", async () => {
    const prisma = twoTenants();
    const { handler } = build({ models: { Post: { scope: () => ({ authorId: 1 }) } } }, prisma);
    const { event, resolve } = createEvent({
      url: '/admin/post/p1',
      body: { _action: 'update', title: 'pwned', authorId: '2' }
    });

    const res = await handler({ event, resolve } as any);

    expect(callsTo(prisma, 'post', 'update')).toHaveLength(0);
    expect(await res.text()).toContain('authorId');
  });
});
