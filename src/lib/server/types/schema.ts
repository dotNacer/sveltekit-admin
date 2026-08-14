/**
 * Generic schema shapes shared by every schema-source adapter (Prisma today,
 * others later). Deliberately identical in shape to what `introspection/
 * parser.ts` has always produced — this file is a rename of that shape, not
 * a redesign of it. `PrismaSchema`/`PrismaModel`/`PrismaField` in parser.ts
 * become aliases of these.
 */

export interface Field {
  name: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  isUpdatedAt: boolean;
  isCreatedAt: boolean;
  hasDefault: boolean;
  defaultValue?: string;
  /** true si `type` correspond à un `enum` déclaré dans le même schéma. */
  isEnum?: boolean;
  relation?: {
    name?: string;
    model: string;
    fields?: string[];
    references?: string[];
  };
  documentation?: string;
}

export interface Model {
  name: string;
  fields: Field[];
  documentation?: string;
  primaryKey?: string;
  isPivotTable?: boolean;
}

export interface Schema {
  models: Model[];
  enums: Map<string, string[]>;
  provider?: string;
}
