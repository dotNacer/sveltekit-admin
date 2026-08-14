import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  is,
  Table
} from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import { MySqlTable } from 'drizzle-orm/mysql-core';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Field, Model, Schema } from '../../types/schema.js';

export type DrizzleDialect = 'postgresql' | 'mysql' | 'sqlite';

export interface M2mLink {
  pivot: Table;
  selfColumn: Column;
  otherColumn: Column;
  selfKey: string;
  otherKey: string;
  targetTsName: string;
}

export interface InspectedDrizzleSchema {
  schema: Schema;
  tables: Record<string, Table>;
  m2m: Map<string, M2mLink>;
  dialect: DrizzleDialect;
}

function inferDialect(tables: Table[]): DrizzleDialect {
  const dialects = new Set<DrizzleDialect>();
  for (const table of tables) {
    if (is(table, PgTable)) dialects.add('postgresql');
    else if (is(table, MySqlTable)) dialects.add('mysql');
    else if (is(table, SQLiteTable)) dialects.add('sqlite');
  }
  if (dialects.size > 1) {
    throw new Error(
      '[sveltekit-admin] createDrizzleAdapter: mixed table dialects in schema (pgTable / mysqlTable / sqliteTable)'
    );
  }
  if (dialects.size === 0) return 'sqlite';
  return [...dialects][0]!;
}

export function mapColumnType(column: Column): { type: string; isEnum: boolean } {
  const enumValues = (column as Column & { enumValues?: string[] }).enumValues;
  if (enumValues && enumValues.length > 0) {
    return {
      type: column.columnType.replace(/^(Pg|MySql|SQLite)/, '') || 'String',
      isEnum: true
    };
  }
  const dataType = column.dataType;
  const columnType = column.columnType;
  if (dataType === 'date' || /Timestamp/i.test(columnType)) {
    return { type: 'DateTime', isEnum: false };
  }
  if (dataType === 'boolean') return { type: 'Boolean', isEnum: false };
  if (dataType === 'json') return { type: 'Json', isEnum: false };
  if (dataType === 'bigint') return { type: 'BigInt', isEnum: false };
  if (dataType === 'buffer') return { type: 'Bytes', isEnum: false };
  if (dataType === 'string') return { type: 'String', isEnum: false };
  if (dataType === 'number') {
    if (/Numeric|Decimal/i.test(columnType)) return { type: 'Decimal', isEnum: false };
    if (/Real|Float|Double/i.test(columnType)) return { type: 'Float', isEnum: false };
    return { type: 'Int', isEnum: false };
  }
  return { type: 'String', isEnum: false };
}

function timestampFlag(
  jsName: string,
  type: string
): { isCreatedAt: boolean; isUpdatedAt: boolean } {
  if (type !== 'DateTime') return { isCreatedAt: false, isUpdatedAt: false };
  const normalizedName = jsName.toLowerCase().replace(/_/g, '');
  return {
    isCreatedAt: normalizedName === 'createdat',
    isUpdatedAt: normalizedName === 'updatedat'
  };
}

export function inspectDrizzleSchema(
  schemaObj: Record<string, unknown>,
  dialectOverride?: DrizzleDialect
): InspectedDrizzleSchema {
  const rawTables: Table[] = [];
  const tables: Record<string, Table> = {};
  for (const [key, value] of Object.entries(schemaObj)) {
    if (is(value, Table)) {
      rawTables.push(value);
      tables[key] = value;
    }
  }

  const inferred = inferDialect(rawTables);
  if (dialectOverride && rawTables.length > 0 && inferred !== dialectOverride) {
    throw new Error(
      `[sveltekit-admin] createDrizzleAdapter: dialect override '${dialectOverride}' does not match inferred '${inferred}'`
    );
  }
  const resolved = dialectOverride ?? inferred;

  const { tables: relationalTables } = extractTablesRelationalConfig(
    schemaObj,
    createTableRelationsHelpers
  );

  const enums = new Map<string, string[]>();
  const models: Model[] = [];

  for (const [tsName, config] of Object.entries(relationalTables)) {
    const fields: Field[] = [];
    for (const [jsName, column] of Object.entries(config.columns)) {
      const { type, isEnum } = mapColumnType(column as Column);
      if (isEnum) {
        const enumValues = (column as Column & { enumValues: string[] }).enumValues;
        enums.set(type, enumValues);
      }
      const { isCreatedAt, isUpdatedAt } = timestampFlag(jsName, type);
      fields.push({
        name: jsName,
        type,
        isRequired: Boolean((column as Column).notNull),
        isList: false,
        isUnique: Boolean((column as Column & { isUnique?: boolean }).isUnique),
        isId: Boolean((column as Column).primary),
        isUpdatedAt,
        isCreatedAt,
        hasDefault: Boolean((column as Column).hasDefault),
        isEnum: isEnum || undefined
      });
    }
    models.push({ name: tsName, fields });
  }

  return {
    schema: { models, enums, provider: resolved },
    tables,
    m2m: new Map(),
    dialect: resolved
  };
}
