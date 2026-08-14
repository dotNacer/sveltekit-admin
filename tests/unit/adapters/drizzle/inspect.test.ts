import { describe, it, expect } from 'vitest';
import type { Column } from 'drizzle-orm';
import { mysqlTable, serial as mysqlSerial } from 'drizzle-orm/mysql-core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { pgEnum, pgTable, serial, text as pgText } from 'drizzle-orm/pg-core';
import {
  inspectDrizzleSchema,
  mapColumnType
} from '../../../../src/lib/server/adapters/drizzle/inspect.js';
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
