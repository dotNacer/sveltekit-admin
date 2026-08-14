import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  is,
  Many,
  One,
  Table
} from 'drizzle-orm';
import type { Column, Relation } from 'drizzle-orm';
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

type InspectedRelation = {
  name: string;
  relation: Relation<string>;
  targetTsName: string;
};

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
  const modelByName = new Map<string, Model>();
  const relationsByModel = new Map<string, InspectedRelation[]>();

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
    const model = { name: tsName, fields };
    models.push(model);
    modelByName.set(tsName, model);
  }

  for (const [tsName, config] of Object.entries(relationalTables)) {
    const inspectedRelations: InspectedRelation[] = [];
    for (const [name, relation] of Object.entries(config.relations)) {
      const targetTsName = Object.entries(tables).find(
        ([, table]) => table === relation.referencedTable
      )![0];
      const relationFields =
        is(relation, One) && relation.config?.fields
          ? relation.config.fields.map(
              (field) =>
                Object.entries(config.columns).find(([, column]) => column === field)![0]
            )
          : undefined;
      modelByName.get(tsName)!.fields.push({
        name,
        type: targetTsName,
        isRequired: false,
        isList: is(relation, Many),
        isUnique: false,
        isId: false,
        isUpdatedAt: false,
        isCreatedAt: false,
        hasDefault: false,
        relation: {
          model: targetTsName,
          name: relation.relationName,
          fields: relationFields
        }
      });
      inspectedRelations.push({ name, relation, targetTsName });
    }
    relationsByModel.set(tsName, inspectedRelations);
  }

  const m2m = new Map<string, M2mLink>();
  for (const [pivotTsName, pivotRelations] of relationsByModel) {
    const owning = pivotRelations.filter(
      ({ relation }) => is(relation, One) && Boolean(relation.config?.fields)
    );
    if (owning.length !== 2 || owning[0]!.targetTsName === owning[1]!.targetTsName) continue;

    const [a, b] = owning;
    const aMany = relationsByModel
      .get(a!.targetTsName)!
      .find(
        ({ relation, targetTsName }) =>
          is(relation, Many) && targetTsName === pivotTsName
      );
    const bMany = relationsByModel
      .get(b!.targetTsName)!
      .find(
        ({ relation, targetTsName }) =>
          is(relation, Many) && targetTsName === pivotTsName
      );
    if (!aMany || !bMany) continue;

    const pivotModel = modelByName.get(pivotTsName)!;
    const aFk = (a!.relation as One<string, boolean>).config!.fields[0]!;
    const bFk = (b!.relation as One<string, boolean>).config!.fields[0]!;
    const aFkJs = Object.entries(relationalTables[pivotTsName]!.columns).find(
      ([, column]) => column === aFk
    )![0];
    const bFkJs = Object.entries(relationalTables[pivotTsName]!.columns).find(
      ([, column]) => column === bFk
    )![0];
    const businessColumns = pivotModel.fields.filter(
      (field) =>
        !field.relation &&
        !field.isId &&
        field.name !== aFkJs &&
        field.name !== bFkJs &&
        !field.isCreatedAt &&
        !field.isUpdatedAt
    );
    if (businessColumns.length > 1) continue;

    const aModel = modelByName.get(a!.targetTsName)!;
    const bModel = modelByName.get(b!.targetTsName)!;
    if (
      aModel.fields.some((field) => field.name === b!.targetTsName) ||
      bModel.fields.some((field) => field.name === a!.targetTsName)
    ) {
      continue;
    }

    pivotModel.isPivotTable = true;
    aModel.fields = aModel.fields.filter((field) => field.name !== aMany.name);
    bModel.fields = bModel.fields.filter((field) => field.name !== bMany.name);
    aModel.fields.push({
      name: b!.targetTsName,
      type: b!.targetTsName,
      isRequired: false,
      isList: true,
      isUnique: false,
      isId: false,
      isUpdatedAt: false,
      isCreatedAt: false,
      hasDefault: false,
      relation: { model: b!.targetTsName }
    });
    bModel.fields.push({
      name: a!.targetTsName,
      type: a!.targetTsName,
      isRequired: false,
      isList: true,
      isUnique: false,
      isId: false,
      isUpdatedAt: false,
      isCreatedAt: false,
      hasDefault: false,
      relation: { model: a!.targetTsName }
    });
    m2m.set(`${a!.targetTsName}.${b!.targetTsName}`, {
      pivot: tables[pivotTsName]!,
      selfColumn: aFk,
      otherColumn: bFk,
      selfKey: aFkJs,
      otherKey: bFkJs,
      targetTsName: b!.targetTsName
    });
    m2m.set(`${b!.targetTsName}.${a!.targetTsName}`, {
      pivot: tables[pivotTsName]!,
      selfColumn: bFk,
      otherColumn: aFk,
      selfKey: bFkJs,
      otherKey: aFkJs,
      targetTsName: a!.targetTsName
    });
  }

  return {
    schema: { models, enums, provider: resolved },
    tables,
    m2m,
    dialect: resolved
  };
}
