import { describe, it, expect } from 'vitest';
import { createPrismaDataAdapter } from '../../../../src/lib/server/adapters/prisma/dataAdapter.js';
import { parsePrismaSchema } from '../../../../src/lib/server/introspection/parser.js';
import { buildRelationGraph } from '../../../../src/lib/server/introspection/relations.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH, RELATIONS_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const User = schema.models.find((m) => m.name === 'User')!;

const relSchema = parsePrismaSchema(RELATIONS_SCHEMA_PATH);
const relGraph = buildRelationGraph(relSchema);
const RelPost = relSchema.models.find((m) => m.name === 'Post')!;
const RelTag = relSchema.models.find((m) => m.name === 'Tag')!;
const tagsEdge = relGraph.edges.get('Post.tags')!;

describe('createPrismaDataAdapter — listRecords', () => {
  it('liste avec skip/take et tri PK desc, count et fetch ensemble', async () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, email: `u${i}@x.y` }));
    const prisma = createPrismaMock({ user: records });
    const adapter = createPrismaDataAdapter(prisma);
    const { rows, total } = await adapter.listRecords(User, { skip: 2, take: 2 });
    expect(rows).toEqual([{ id: 3, email: 'u2@x.y' }, { id: 4, email: 'u3@x.y' }]);
    expect(total).toBe(5);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({
      where: undefined, skip: 2, take: 2, orderBy: { id: 'desc' }
    });
  });

  it('propage un Filter compilé au where', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }, { id: 2, email: 'b@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    const { rows, total } = await adapter.listRecords(User, { filter: { op: 'eq', field: 'id', value: 2 }, skip: 0, take: 20 });
    expect(rows).toEqual([{ id: 2, email: 'b@x.y' }]);
    expect(total).toBe(1);
  });
});

describe('createPrismaDataAdapter — listRecords trié', () => {
  const adapterFor = (records: any[]) => {
    const prisma = createPrismaMock({ user: records });
    return { prisma, adapter: createPrismaDataAdapter(prisma) };
  };

  it('trie sur la colonne demandée, puis départage par la clé primaire', async () => {
    // Sans le départage, deux lignes de même `email` peuvent changer de page
    // entre deux requêtes : la fenêtre skip/take n'a alors plus de sens.
    const { prisma, adapter } = adapterFor([{ id: 1, email: 'a@x.y' }]);
    await adapter.listRecords(User, { skip: 0, take: 20, orderBy: { field: 'email', dir: 'asc' } });

    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({
      orderBy: [{ email: 'asc' }, { id: 'desc' }]
    });
  });

  it('accepte la direction descendante', async () => {
    const { prisma, adapter } = adapterFor([{ id: 1, email: 'a@x.y' }]);
    await adapter.listRecords(User, { skip: 0, take: 20, orderBy: { field: 'email', dir: 'desc' } });

    expect((callsTo(prisma, 'user', 'findMany')[0].args as any).orderBy[0]).toEqual({ email: 'desc' });
  });

  it('ne redouble pas la clé primaire quand c’est elle qu’on trie', async () => {
    const { prisma, adapter } = adapterFor([{ id: 1, email: 'a@x.y' }]);
    await adapter.listRecords(User, { skip: 0, take: 20, orderBy: { field: 'id', dir: 'asc' } });

    expect((callsTo(prisma, 'user', 'findMany')[0].args as any).orderBy).toEqual([{ id: 'asc' }]);
  });

  it('garde le tri PK desc quand rien n’est demandé', async () => {
    const { prisma, adapter } = adapterFor([{ id: 1, email: 'a@x.y' }]);
    await adapter.listRecords(User, { skip: 0, take: 20 });

    expect((callsTo(prisma, 'user', 'findMany')[0].args as any).orderBy).toEqual({ id: 'desc' });
  });
});

describe('createPrismaDataAdapter — deleteMany', () => {
  it('supprime les lignes désignées et renvoie le compte', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const adapter = createPrismaDataAdapter(prisma);

    expect(await adapter.deleteMany(User, [1, 3])).toBe(2);
    expect((callsTo(prisma, 'user', 'deleteMany')[0].args as any).where).toMatchObject({
      id: { in: [1, 3] }
    });
  });

  it('compose le filtre d’autorisation avec les ids', async () => {
    // Un id hors scope ne matche simplement pas : pas d'erreur, donc aucun
    // moyen de distinguer « n'existe pas » de « appartient à un autre tenant ».
    const prisma = createPrismaMock({ user: [{ id: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);

    await adapter.deleteMany(User, [1, 2], { op: 'eq', field: 'tenantId', value: 7 });

    const where = (callsTo(prisma, 'user', 'deleteMany')[0].args as any).where;
    expect(where).toMatchObject({ id: { in: [1, 2] } });
    expect(where.AND).toBeDefined();
  });
});

describe('createPrismaDataAdapter — findMany', () => {
  it('sans skip/take : renvoie tout ce qui matche, orderBy transmis tel quel', async () => {
    const records = [{ id: 2, name: 'B' }, { id: 1, name: 'A' }];
    const prisma = createPrismaMock({ user: records });
    const adapter = createPrismaDataAdapter(prisma);
    const rows = await adapter.findMany(User, { orderBy: { name: 'asc' } });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({ where: undefined, orderBy: { name: 'asc' } });
    expect(rows).toEqual(records);
  });

  it('avec skip/take : pagination transmise', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.findMany(User, { skip: 1, take: 1 });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({ skip: 1, take: 1 });
  });
});

describe('createPrismaDataAdapter — countRecords / getRecord / findFirst', () => {
  it('countRecords sans filter', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.countRecords(User)).toBe(2);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: undefined });
  });

  it('countRecords avec filter compilé', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.countRecords(User, { op: 'eq', field: 'id', value: 1 })).toBe(1);
  });

  it('getRecord coerce l\'id via la PK du modèle', async () => {
    const prisma = createPrismaMock({ user: [{ id: 3, email: 'c@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.getRecord(User, '3')).toEqual({ id: 3, email: 'c@x.y' });
  });

  it('findFirst applique le filter tel quel (scoping)', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, tenantId: 9 }, { id: 2, tenantId: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);
    const row = await adapter.findFirst(User, {
      op: 'and',
      clauses: [{ op: 'eq', field: 'id', value: 1 }, { tenantId: 9 } as never]
    });
    expect(row).toEqual({ id: 1, tenantId: 9 });
  });
});

describe('createPrismaDataAdapter — createRecord / updateRecord (sans m2m)', () => {
  it('createRecord sans m2m : create direct, pas de $transaction', async () => {
    const prisma = createPrismaMock({ user: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(User, { scalars: { email: 'n@x.y' } });
    expect(callsTo(prisma, 'user', 'create')[0].args).toEqual({ data: { email: 'n@x.y' } });
    expect(prisma.calls.some((c) => c.method === '$transaction')).toBe(false);
  });

  it('updateRecord sans m2m : update direct par PK coercée', async () => {
    const prisma = createPrismaMock({ user: [{ id: 2, email: 'old@x.y' }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(User, '2', { scalars: { email: 'new@x.y' } });
    expect(callsTo(prisma, 'user', 'update')[0].args).toEqual({ where: { id: 2 }, data: { email: 'new@x.y' } });
  });

  it('valide les guards FK dans la transaction avant create/update', async () => {
    const prisma = createPrismaMock({ post: [], user: [{ id: 1, tenantId: 7 }] });
    const adapter = createPrismaDataAdapter(prisma);
    const guard = { targetModel: User, targetPk: 1, filter: { op: 'eq' as const, field: 'tenantId', value: 7 } };
    await adapter.createRecord(RelPost, { scalars: { title: 'T', authorId: 1 }, targetGuards: [guard] });
    await adapter.updateRecord(RelPost, 'p1', { scalars: { title: 'T2' }, targetGuards: [guard] });
    expect(callsTo(prisma, 'user', 'findFirst')).toHaveLength(2);
  });

  it('refuse une cible FK hors scope avant toute écriture', async () => {
    const prisma = createPrismaMock({ post: [], user: [{ id: 1, tenantId: 9 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await expect(adapter.createRecord(RelPost, { scalars: { title: 'T' }, targetGuards: [{ targetModel: User, targetPk: 1, filter: { op: 'eq', field: 'tenantId', value: 7 } }] })).rejects.toThrow(/outside/);
    expect(callsTo(prisma, 'post', 'create')).toHaveLength(0);
  });

  it('deleteRecord par PK coercée', async () => {
    const prisma = createPrismaMock({ user: [{ id: 2 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.deleteRecord(User, '2');
    expect(callsTo(prisma, 'user', 'delete')[0].args).toEqual({ where: { id: 2 } });
  });

  it('compose le scope d’autorisation sur update/delete', async () => {
    const prisma = createPrismaMock({ user: [{ id: 2, tenantId: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);
    const scope = { op: 'eq' as const, field: 'tenantId', value: 1 };
    await adapter.updateRecord(User, '2', { scalars: { email: 'scoped@x.y' } }, scope);
    await adapter.deleteRecord(User, '2', scope);
    expect((callsTo(prisma, 'user', 'update')[0].args as any).where).toEqual({ id: 2, AND: [{ tenantId: 1 }] });
    expect((callsTo(prisma, 'user', 'delete')[0].args as any).where).toEqual({ id: 2, AND: [{ tenantId: 1 }] });
  });
});

describe('createPrismaDataAdapter — createRecord / updateRecord (avec m2m)', () => {
  it('createRecord avec m2m : connect, dans une transaction', async () => {
    const prisma = createPrismaMock({ post: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(RelPost, {
      scalars: { title: 'T', authorId: 1 },
      m2m: { tags: { targetPkField: 'id', ids: [1, 2] } }
    });
    const create = callsTo(prisma, 'post', 'create')[0];
    expect(create.args).toEqual({ data: { title: 'T', authorId: 1, tags: { connect: [{ id: 1 }, { id: 2 }] } } });
  });

  it('updateRecord avec m2m : set, dans une transaction', async () => {
    const prisma = createPrismaMock({ post: [{ id: 'p1', title: 'T', authorId: 1 }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(RelPost, 'p1', {
      scalars: { title: 'T2' },
      m2m: { tags: { targetPkField: 'id', ids: [2] } }
    });
    const update = callsTo(prisma, 'post', 'update')[0];
    expect(update.args).toEqual({ where: { id: 'p1' }, data: { title: 'T2', tags: { set: [{ id: 2 }] } } });
  });

  it('m2m avec une liste vide : set: [] (vide la relation), toujours transactionnel', async () => {
    const prisma = createPrismaMock({ post: [{ id: 'p1', title: 'T' }] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.updateRecord(RelPost, 'p1', {
      scalars: { title: 'T' },
      m2m: { tags: { targetPkField: 'id', ids: [] } }
    });
    expect(callsTo(prisma, 'post', 'update')[0].args).toEqual({ where: { id: 'p1' }, data: { title: 'T', tags: { set: [] } } });
  });

  it('m2m sur une PK cible String (non-Int) : idRefs porte des strings', async () => {
    const prisma = createPrismaMock({ post: [] });
    const adapter = createPrismaDataAdapter(prisma);
    await adapter.createRecord(RelPost, {
      scalars: { title: 'T' },
      m2m: { labels: { targetPkField: 'slug', ids: ['a', 'b'] } }
    });
    expect(callsTo(prisma, 'post', 'create')[0].args).toEqual({
      data: { title: 'T', labels: { connect: [{ slug: 'a' }, { slug: 'b' }] } }
    });
  });
});

describe('createPrismaDataAdapter — getM2mSelectedIds', () => {
  it('lit les ids liés via include, mappés sur la PK cible', async () => {
    const prisma = createPrismaMock({
      post: [{ id: 'p1', title: 'T', tags: [{ id: 1, name: 'js' }, { id: 2, name: 'ts' }] }]
    });
    const adapter = createPrismaDataAdapter(prisma);
    const ids = await adapter.getM2mSelectedIds(RelPost, tagsEdge, RelTag, 'p1');
    expect(ids).toEqual([1, 2]);
    expect(callsTo(prisma, 'post', 'findUnique')[0].args).toEqual({
      where: { id: 'p1' }, include: { tags: true }
    });
  });

  it('cible absente du client : liste vide, pas de throw', async () => {
    const prisma = createPrismaMock({});
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.getM2mSelectedIds(RelPost, tagsEdge, RelTag, 'p1')).toEqual([]);
  });

  it('recordId sans enregistrement correspondant : findUnique renvoie null, liste vide sans throw', async () => {
    // Modèle présent côté client (contrairement au test précédent) mais aucun
    // enregistrement ne matche : `findUnique` renvoie `null`, ce qui exerce la
    // branche `current?.[edge.field] ?? []` sans passer par le `catch`.
    const prisma = createPrismaMock({ post: [] });
    const adapter = createPrismaDataAdapter(prisma);
    expect(await adapter.getM2mSelectedIds(RelPost, tagsEdge, RelTag, 'missing')).toEqual([]);
  });
});
