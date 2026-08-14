import { describe, it, expect } from 'vitest';
import { relations } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import { mysqlTable, serial as mysqlSerial } from 'drizzle-orm/mysql-core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { pgEnum, pgTable, serial, text as pgText } from 'drizzle-orm/pg-core';
import {
  inspectDrizzleSchema,
  mapColumnType
} from '../../../../src/lib/server/adapters/drizzle/inspect.js';
import { buildRelationGraph } from '../../../../src/lib/server/introspection/relations.js';
import * as full from '../../../fixtures/drizzle/schema.js';

describe('inspectDrizzleSchema — tables / types / dialect', () => {
  it("Model.name = clé d'export JS, Field.name = clé JS colonne", () => {
    const { schema, dialect, tables } = inspectDrizzleSchema(full);
    expect(dialect).toBe('sqlite');
    expect(schema.provider).toBe('sqlite');
    expect(schema.models.map((m) => m.name).sort()).toEqual(
      ['posts', 'postsToTags', 'tags', 'users'].sort()
    );
    const users = schema.models.find((m) => m.name === 'users')!;
    expect(users.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['id', 'email', 'name', 'tenantId', 'createdAt'])
    );
    expect(users.fields.find((f) => f.name === 'id')).toMatchObject({
      type: 'Int',
      isId: true,
      isRequired: true
    });
    expect(users.fields.find((f) => f.name === 'email')).toMatchObject({
      type: 'String',
      isRequired: true
    });
    expect(users.fields.find((f) => f.name === 'name')).toMatchObject({
      type: 'String',
      isRequired: false
    });
    expect(users.fields.find((f) => f.name === 'createdAt')).toMatchObject({
      type: 'DateTime',
      isCreatedAt: true
    });
    expect(tables.users).toBe(full.users);
  });

  it('schéma vide → models [] sans throw', () => {
    const { schema } = inspectDrizzleSchema({});
    expect(schema.models).toEqual([]);
  });

  it('ignore les exports non-Table (relations, helpers)', () => {
    const { schema } = inspectDrizzleSchema(full);
    expect(schema.models.find((m) => m.name === 'usersRelations')).toBeUndefined();
  });

  it('infère postgresql depuis pgTable', () => {
    const users = pgTable('users', { id: serial('id').primaryKey(), name: pgText('name') });
    const { dialect } = inspectDrizzleSchema({ users });
    expect(dialect).toBe('postgresql');
  });

  it('infère mysql depuis mysqlTable', () => {
    const users = mysqlTable('users', { id: mysqlSerial('id').primaryKey() });
    expect(inspectDrizzleSchema({ users }).dialect).toBe('mysql');
  });

  it('throw si tables de dialectes mixtes', () => {
    const sqliteUsers = sqliteTable('users', { id: integer('id').primaryKey() });
    const pgUsers = pgTable('others', { id: serial('id').primaryKey() });
    expect(() => inspectDrizzleSchema({ sqliteUsers, pgUsers })).toThrow(/mixed table dialects/);
  });

  it("dialect optionnel identique à l'inférence est accepté", () => {
    const users = sqliteTable('users', { id: integer('id').primaryKey(), name: text('name') });
    expect(inspectDrizzleSchema({ users }, 'sqlite').dialect).toBe('sqlite');
  });

  it('pgEnum → isEnum + Schema.enums', () => {
    const role = pgEnum('role', ['admin', 'user']);
    const members = pgTable('members', { id: serial('id').primaryKey(), role: role('role') });
    const { schema } = inspectDrizzleSchema({ members, role });
    const field = schema.models
      .find((m) => m.name === 'members')!
      .fields.find((f) => f.name === 'role')!;
    expect(field.isEnum).toBe(true);
    expect([...schema.enums.values()].some((v) => v.includes('admin') && v.includes('user'))).toBe(
      true
    );
  });

  it('conserve des clés distinctes pour deux pgEnum', () => {
    const role = pgEnum('member_role', ['admin', 'user']);
    const state = pgEnum('member_state', ['active', 'disabled']);
    const members = pgTable('members', {
      id: serial('id').primaryKey(),
      role: role('role'),
      state: state('state')
    });

    const { schema } = inspectDrizzleSchema({ members, role, state });
    const fields = schema.models.find((model) => model.name === 'members')!.fields;
    const roleField = fields.find((field) => field.name === 'role')!;
    const stateField = fields.find((field) => field.name === 'state')!;

    expect(roleField.type).not.toBe(stateField.type);
    expect(schema.enums.size).toBe(2);
    expect(schema.enums.get(roleField.type)).toEqual(['admin', 'user']);
    expect(schema.enums.get(stateField.type)).toEqual(['active', 'disabled']);
  });

  it('dialect override en désaccord avec les tables → throw', () => {
    const users = sqliteTable('users', { id: integer('id').primaryKey() });
    expect(() => inspectDrizzleSchema({ users }, 'postgresql')).toThrow(
      /does not match inferred/
    );
  });

  it('mappe tous les types scalaires Drizzle génériques', () => {
    const column = (dataType: string, columnType: string, enumValues?: string[]) =>
      ({ dataType, columnType, enumValues }) as unknown as Column;

    expect(mapColumnType(column('date', 'CustomDate'))).toEqual({
      type: 'DateTime',
      isEnum: false
    });
    expect(mapColumnType(column('number', 'CustomTimestamp'))).toEqual({
      type: 'DateTime',
      isEnum: false
    });
    expect(mapColumnType(column('boolean', 'Boolean'))).toEqual({
      type: 'Boolean',
      isEnum: false
    });
    expect(mapColumnType(column('json', 'Json'))).toEqual({ type: 'Json', isEnum: false });
    expect(mapColumnType(column('bigint', 'BigInt'))).toEqual({
      type: 'BigInt',
      isEnum: false
    });
    expect(mapColumnType(column('buffer', 'Buffer'))).toEqual({
      type: 'Bytes',
      isEnum: false
    });
    expect(mapColumnType(column('string', 'Text'))).toEqual({ type: 'String', isEnum: false });
    expect(mapColumnType(column('number', 'Numeric'))).toEqual({
      type: 'Decimal',
      isEnum: false
    });
    expect(mapColumnType(column('number', 'Double'))).toEqual({
      type: 'Float',
      isEnum: false
    });
    expect(mapColumnType(column('number', 'Integer'))).toEqual({ type: 'Int', isEnum: false });
    expect(mapColumnType(column('custom', 'Custom'))).toEqual({
      type: 'String',
      isEnum: false
    });
    expect(mapColumnType(column('string', 'PgRole', ['admin']))).toEqual({
      type: 'Role',
      isEnum: true
    });
    expect(mapColumnType(column('string', 'Pg', ['admin']))).toEqual({
      type: 'String',
      isEnum: true
    });
    expect(mapColumnType(column('string', 'Text', []))).toEqual({
      type: 'String',
      isEnum: false
    });
  });

  it('marque updated_at sans le confondre avec createdAt', () => {
    const events = sqliteTable('events', {
      updated_at: integer('updated_at', { mode: 'timestamp' }),
      happenedAt: integer('happened_at', { mode: 'timestamp' })
    });
    const model = inspectDrizzleSchema({ events }, 'sqlite').schema.models[0]!;
    expect(model.fields.find((field) => field.name === 'updated_at')).toMatchObject({
      isCreatedAt: false,
      isUpdatedAt: true
    });
    expect(model.fields.find((field) => field.name === 'happenedAt')).toMatchObject({
      isCreatedAt: false,
      isUpdatedAt: false
    });
  });

  it('accepte un override sur un schéma vide', () => {
    const inspected = inspectDrizzleSchema({}, 'postgresql');
    expect(inspected.dialect).toBe('postgresql');
    expect(inspected.schema.provider).toBe('postgresql');
  });
});

describe('inspectDrizzleSchema — relations v1 + m2m', () => {
  it('one({ fields }) → owning ; many(non-pivot) → inverse', () => {
    const { schema } = inspectDrizzleSchema(full);
    const posts = schema.models.find((m) => m.name === 'posts')!;
    const author = posts.fields.find((f) => f.name === 'author')!;
    expect(author.relation).toMatchObject({ model: 'users', fields: ['authorId'] });
    expect(author.isList).toBe(false);
    const users = schema.models.find((m) => m.name === 'users')!;
    const userPosts = users.fields.find((f) => f.name === 'posts')!;
    expect(userPosts.relation).toMatchObject({ model: 'posts' });
    expect(userPosts.isList).toBe(true);
    expect(userPosts.relation?.fields).toBeUndefined();
  });

  it("pivot pur → isPivotTable + m2m synthétisé nommé d'après l'export opposé", () => {
    const { schema, m2m } = inspectDrizzleSchema(full);
    const pivot = schema.models.find((m) => m.name === 'postsToTags')!;
    expect(pivot.isPivotTable).toBe(true);
    const posts = schema.models.find((m) => m.name === 'posts')!;
    expect(posts.fields.find((f) => f.name === 'postsToTags')).toBeUndefined();
    const tagsField = posts.fields.find((f) => f.name === 'tags')!;
    expect(tagsField.isList).toBe(true);
    expect(tagsField.relation).toMatchObject({ model: 'tags' });
    expect(tagsField.relation?.fields).toBeUndefined();
    const tags = schema.models.find((m) => m.name === 'tags')!;
    expect(tags.fields.find((f) => f.name === 'posts')?.relation).toMatchObject({
      model: 'posts'
    });
    expect(m2m.has('posts.tags')).toBe(true);
    expect(m2m.has('tags.posts')).toBe(true);
    const graph = buildRelationGraph(schema);
    expect(graph.edges.get('posts.tags')?.kind).toBe('m2m');
    expect(graph.edges.get('tags.posts')?.kind).toBe('m2m');
    expect(graph.edges.get('posts.author')?.kind).toBe('to-one-owning');
  });

  it("sans relations() : scalaires seulement, pas d'arête inventée depuis .references()", () => {
    const lone = sqliteTable('posts', {
      id: integer('id').primaryKey(),
      authorId: integer('author_id').notNull()
    });
    const { schema } = inspectDrizzleSchema({ posts: lone });
    const posts = schema.models.find((m) => m.name === 'posts')!;
    expect(posts.fields.every((f) => !f.relation)).toBe(true);
    expect(posts.fields.find((f) => f.name === 'author')).toBeUndefined();
    expect(posts.fields.find((f) => f.name === 'authorId')).toBeTruthy();
  });

  it('collision de nom : pas de synthèse m2m si le champ opposé existe déjà', () => {
    const a = sqliteTable('a', { id: integer('id').primaryKey() });
    const b = sqliteTable('b', {
      id: integer('id').primaryKey(),
      a: text('a')
    });
    const pivot = sqliteTable('a_to_b', {
      aId: integer('a_id').notNull(),
      bId: integer('b_id').notNull()
    });
    const aRel = relations(a, ({ many }) => ({ a_to_b: many(pivot) }));
    const bRel = relations(b, ({ many }) => ({ a_to_b: many(pivot) }));
    const pRel = relations(pivot, ({ one }) => ({
      a: one(a, { fields: [pivot.aId], references: [a.id] }),
      b: one(b, { fields: [pivot.bId], references: [b.id] })
    }));
    const { schema, m2m } = inspectDrizzleSchema({ a, b, a_to_b: pivot, aRel, bRel, pRel });
    const modelB = schema.models.find((m) => m.name === 'b')!;
    expect(modelB.fields.find((f) => f.name === 'a' && f.relation?.model === 'a')).toBeUndefined();
    expect(schema.models.find((model) => model.name === 'a_to_b')!.isPivotTable).toBeUndefined();
    expect(m2m.size).toBe(0);
  });

  it('one sans fields reste une relation inverse non-list', () => {
    const users = sqliteTable('users', { id: integer('id').primaryKey() });
    const profiles = sqliteTable('profiles', {
      id: integer('id').primaryKey(),
      userId: integer('user_id').notNull()
    });
    const usersRel = relations(users, ({ one }) => ({ profile: one(profiles) }));
    const profilesRel = relations(profiles, ({ one }) => ({
      user: one(users, { fields: [profiles.userId], references: [users.id] })
    }));

    const user = inspectDrizzleSchema({ users, profiles, usersRel, profilesRel }).schema.models.find(
      (model) => model.name === 'users'
    )!;
    expect(user.fields.find((field) => field.name === 'profile')).toMatchObject({
      isList: false,
      relation: { model: 'profiles', fields: undefined }
    });
  });

  it('pivot auto-référencé : conserve many(P) sans synthèse', () => {
    const nodes = sqliteTable('nodes', { id: integer('id').primaryKey() });
    const nodeLinks = sqliteTable('node_links', {
      parentId: integer('parent_id').notNull(),
      childId: integer('child_id').notNull()
    });
    const nodesRel = relations(nodes, ({ many }) => ({ nodeLinks: many(nodeLinks) }));
    const linksRel = relations(nodeLinks, ({ one }) => ({
      parent: one(nodes, {
        fields: [nodeLinks.parentId],
        references: [nodes.id],
        relationName: 'parent'
      }),
      child: one(nodes, {
        fields: [nodeLinks.childId],
        references: [nodes.id],
        relationName: 'child'
      })
    }));

    const { schema, m2m } = inspectDrizzleSchema({ nodes, nodeLinks, nodesRel, linksRel });
    expect(schema.models.find((model) => model.name === 'nodes')!.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'nodeLinks', isList: true })])
    );
    expect(schema.models.find((model) => model.name === 'nodeLinks')!.isPivotTable).toBeUndefined();
    expect(m2m.size).toBe(0);
  });

  it.each(['a', 'b'] as const)(
    'relations() manquant côté %s : conserve many(P) sans synthèse',
    (missingSide) => {
      const a = sqliteTable('a', { id: integer('id').primaryKey() });
      const b = sqliteTable('b', { id: integer('id').primaryKey() });
      const pivot = sqliteTable('a_to_b', {
        aId: integer('a_id').notNull(),
        bId: integer('b_id').notNull()
      });
      const aRel = relations(a, ({ many }) => ({ pivot: many(pivot) }));
      const bRel = relations(b, ({ many }) => ({ pivot: many(pivot) }));
      const pRel = relations(pivot, ({ one }) => ({
        a: one(a, { fields: [pivot.aId], references: [a.id] }),
        b: one(b, { fields: [pivot.bId], references: [b.id] })
      }));
      const relationExports = missingSide === 'a' ? { bRel, pRel } : { aRel, pRel };

      const { schema, m2m } = inspectDrizzleSchema({ a, b, pivot, ...relationExports });
      expect(schema.models.find((model) => model.name === 'pivot')!.isPivotTable).toBeUndefined();
      expect(m2m.size).toBe(0);
    }
  );

  it('pivot avec plus d’une colonne métier : pas de synthèse', () => {
    const a = sqliteTable('a', { id: integer('id').primaryKey() });
    const b = sqliteTable('b', { id: integer('id').primaryKey() });
    const pivot = sqliteTable('a_to_b', {
      aId: integer('a_id').notNull(),
      bId: integer('b_id').notNull(),
      createdAt: integer('created_at', { mode: 'timestamp' }),
      updatedAt: integer('updated_at', { mode: 'timestamp' }),
      role: text('role'),
      note: text('note')
    });
    const aRel = relations(a, ({ many }) => ({ pivot: many(pivot) }));
    const bRel = relations(b, ({ many }) => ({ pivot: many(pivot) }));
    const pRel = relations(pivot, ({ one }) => ({
      a: one(a, { fields: [pivot.aId], references: [a.id] }),
      b: one(b, { fields: [pivot.bId], references: [b.id] })
    }));

    const { schema, m2m } = inspectDrizzleSchema({ a, b, pivot, aRel, bRel, pRel });
    expect(schema.models.find((model) => model.name === 'pivot')!.isPivotTable).toBeUndefined();
    expect(m2m.size).toBe(0);
  });

  it('pivot avec une colonne métier : pas de synthèse', () => {
    const a = sqliteTable('a', { id: integer('id').primaryKey() });
    const b = sqliteTable('b', { id: integer('id').primaryKey() });
    const pivot = sqliteTable('a_to_b', {
      aId: integer('a_id').notNull(),
      bId: integer('b_id').notNull(),
      role: text('role')
    });
    const aRel = relations(a, ({ many }) => ({ pivot: many(pivot) }));
    const bRel = relations(b, ({ many }) => ({ pivot: many(pivot) }));
    const pRel = relations(pivot, ({ one }) => ({
      a: one(a, { fields: [pivot.aId], references: [a.id] }),
      b: one(b, { fields: [pivot.bId], references: [b.id] })
    }));

    const { schema, m2m } = inspectDrizzleSchema({ a, b, pivot, aRel, bRel, pRel });
    expect(schema.models.find((model) => model.name === 'pivot')!.isPivotTable).toBeUndefined();
    expect(schema.models.find((model) => model.name === 'a')!.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pivot', isList: true })])
    );
    expect(m2m.size).toBe(0);
  });

  it('collision côté premier modèle : pas de synthèse m2m', () => {
    const a = sqliteTable('a', { id: integer('id').primaryKey(), b: text('b') });
    const b = sqliteTable('b', { id: integer('id').primaryKey() });
    const pivot = sqliteTable('a_to_b', {
      aId: integer('a_id').notNull(),
      bId: integer('b_id').notNull()
    });
    const aRel = relations(a, ({ many }) => ({ pivot: many(pivot) }));
    const bRel = relations(b, ({ many }) => ({ pivot: many(pivot) }));
    const pRel = relations(pivot, ({ one }) => ({
      a: one(a, { fields: [pivot.aId], references: [a.id] }),
      b: one(b, { fields: [pivot.bId], references: [b.id] })
    }));

    const { schema, m2m } = inspectDrizzleSchema({ a, b, pivot, aRel, bRel, pRel });
    expect(schema.models.find((model) => model.name === 'a')!.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pivot', isList: true })])
    );
    expect(schema.models.find((model) => model.name === 'pivot')!.isPivotTable).toBeUndefined();
    expect(m2m.size).toBe(0);
  });
});
