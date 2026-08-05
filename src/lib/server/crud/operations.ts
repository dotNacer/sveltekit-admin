/**
 * CRUD Operations Generator
 * Creates type-safe Prisma operations for admin panel
 */

import type { PrismaModel, PrismaField } from '../introspection/parser.js';

export interface ListOptions {
  page?: number;
  perPage?: number;
  search?: string;
  searchFields?: string[];
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/**
 * Build a Prisma where clause for searching
 */
export function buildSearchWhere(
  search: string | undefined,
  searchFields: string[],
  model: PrismaModel
): Record<string, unknown> | undefined {
  if (!search || searchFields.length === 0) return undefined;

  const stringFields = searchFields.filter(fieldName => {
    const field = model.fields.find(f => f.name === fieldName);
    return field?.type === 'String';
  });

  if (stringFields.length === 0) return undefined;

  return {
    OR: stringFields.map(field => ({
      [field]: {
        contains: search,
        mode: 'insensitive'
      }
    }))
  };
}

/**
 * Build filter conditions from query params
 */
export function buildFilterWhere(
  filters: Record<string, unknown> | undefined,
  model: PrismaModel
): Record<string, unknown> {
  if (!filters) return {};

  const where: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;

    const field = model.fields.find(f => f.name === key);
    if (!field) continue;

    // Handle different field types
    switch (field.type) {
      case 'String':
        where[key] = { contains: String(value), mode: 'insensitive' };
        break;
      case 'Int':
      case 'Float':
      case 'Decimal':
      case 'BigInt':
        where[key] = Number(value);
        break;
      case 'Boolean':
        where[key] = value === 'true' || value === true;
        break;
      case 'DateTime':
        // Support date range filters
        if (typeof value === 'object' && value !== null) {
          const dateFilter: Record<string, Date> = {};
          if ('from' in value) dateFilter.gte = new Date(value.from as string);
          if ('to' in value) dateFilter.lte = new Date(value.to as string);
          where[key] = dateFilter;
        } else {
          where[key] = new Date(String(value));
        }
        break;
      default:
        // For enums and relations
        where[key] = value;
    }
  }

  return where;
}

/**
 * Create list operation config
 */
export function createListOperation(model: PrismaModel) {
  const searchableFields = model.fields
    .filter(f => f.type === 'String' && !f.relation)
    .map(f => f.name);

  return {
    modelName: model.name,
    searchableFields,
    defaultOrderBy: model.primaryKey || 'id',
    
    async execute<T>(
      prisma: { [key: string]: { findMany: Function; count: Function } },
      options: ListOptions = {}
    ): Promise<ListResult<T>> {
      const {
        page = 1,
        perPage = 20,
        search,
        searchFields = searchableFields,
        orderBy = model.primaryKey || 'id',
        orderDir = 'desc',
        filters
      } = options;

      const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const prismaModel = prisma[modelKey];

      if (!prismaModel) {
        throw new Error(`Model ${model.name} not found in Prisma client`);
      }

      // Build where clause
      const searchWhere = buildSearchWhere(search, searchFields, model);
      const filterWhere = buildFilterWhere(filters, model);

      const where = {
        ...filterWhere,
        ...(searchWhere ? searchWhere : {})
      };

      // Build include for relations (limit depth)
      const include = buildInclude(model);

      // Execute queries
      const [items, total] = await Promise.all([
        prismaModel.findMany({
          where,
          include,
          orderBy: { [orderBy]: orderDir },
          skip: (page - 1) * perPage,
          take: perPage
        }),
        prismaModel.count({ where })
      ]);

      return {
        items: items as T[],
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage)
      };
    }
  };
}

/**
 * Create get single record operation
 */
export function createGetOperation(model: PrismaModel) {
  return {
    modelName: model.name,
    
    async execute<T>(
      prisma: { [key: string]: { findUnique: Function } },
      id: string | number
    ): Promise<T | null> {
      const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const prismaModel = prisma[modelKey];

      if (!prismaModel) {
        throw new Error(`Model ${model.name} not found in Prisma client`);
      }

      const primaryKey = model.primaryKey || 'id';
      const include = buildInclude(model);

      // Convert ID to correct type
      const pkField = model.fields.find(f => f.name === primaryKey);
      const typedId = pkField?.type === 'Int' ? parseInt(String(id)) : id;

      return prismaModel.findUnique({
        where: { [primaryKey]: typedId },
        include
      }) as Promise<T | null>;
    }
  };
}

/**
 * Create create operation
 */
export function createCreateOperation(model: PrismaModel) {
  return {
    modelName: model.name,
    
    async execute<T>(
      prisma: { [key: string]: { create: Function } },
      data: Record<string, unknown>
    ): Promise<T> {
      const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const prismaModel = prisma[modelKey];

      if (!prismaModel) {
        throw new Error(`Model ${model.name} not found in Prisma client`);
      }

      // Process data - handle relations
      const processedData = processInputData(data, model);

      return prismaModel.create({
        data: processedData
      }) as Promise<T>;
    }
  };
}

/**
 * Create update operation
 */
export function createUpdateOperation(model: PrismaModel) {
  return {
    modelName: model.name,
    
    async execute<T>(
      prisma: { [key: string]: { update: Function } },
      id: string | number,
      data: Record<string, unknown>
    ): Promise<T> {
      const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const prismaModel = prisma[modelKey];

      if (!prismaModel) {
        throw new Error(`Model ${model.name} not found in Prisma client`);
      }

      const primaryKey = model.primaryKey || 'id';
      const pkField = model.fields.find(f => f.name === primaryKey);
      const typedId = pkField?.type === 'Int' ? parseInt(String(id)) : id;

      // Process data - handle relations
      const processedData = processInputData(data, model);

      return prismaModel.update({
        where: { [primaryKey]: typedId },
        data: processedData
      }) as Promise<T>;
    }
  };
}

/**
 * Create delete operation
 */
export function createDeleteOperation(model: PrismaModel) {
  return {
    modelName: model.name,
    
    async execute(
      prisma: { [key: string]: { delete: Function } },
      id: string | number
    ): Promise<void> {
      const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const prismaModel = prisma[modelKey];

      if (!prismaModel) {
        throw new Error(`Model ${model.name} not found in Prisma client`);
      }

      const primaryKey = model.primaryKey || 'id';
      const pkField = model.fields.find(f => f.name === primaryKey);
      const typedId = pkField?.type === 'Int' ? parseInt(String(id)) : id;

      await prismaModel.delete({
        where: { [primaryKey]: typedId }
      });
    }
  };
}

/**
 * Build include object for relations
 */
function buildInclude(model: PrismaModel): Record<string, boolean> {
  const include: Record<string, boolean> = {};
  
  for (const field of model.fields) {
    if (field.relation && !field.isList) {
      // Only include single relations, not lists (for performance)
      include[field.name] = true;
    }
  }
  
  return Object.keys(include).length > 0 ? include : undefined as any;
}

/**
 * Process input data for create/update
 */
function processInputData(
  data: Record<string, unknown>,
  model: PrismaModel
): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  for (const field of model.fields) {
    // Skip auto-generated fields
    if (field.isId || field.isCreatedAt || field.isUpdatedAt) continue;
    
    const value = data[field.name];
    
    // Skip undefined values
    if (value === undefined) continue;

    // Handle relations
    if (field.relation?.fields) {
      // This is the "owning" side of a relation with foreign key
      // User provides the related ID directly
      const fkField = field.relation.fields[0];
      if (data[fkField] !== undefined) {
        processed[fkField] = data[fkField];
      }
      continue;
    }

    // Handle type conversions
    if (value !== null && value !== '') {
      switch (field.type) {
        case 'Int':
        case 'BigInt':
          processed[field.name] = parseInt(String(value));
          break;
        case 'Float':
        case 'Decimal':
          processed[field.name] = parseFloat(String(value));
          break;
        case 'Boolean':
          processed[field.name] = value === true || value === 'true' || value === 'on';
          break;
        case 'DateTime':
          processed[field.name] = new Date(String(value));
          break;
        case 'Json':
          processed[field.name] = typeof value === 'string' ? JSON.parse(value) : value;
          break;
        default:
          processed[field.name] = value;
      }
    } else if (!field.isRequired) {
      processed[field.name] = null;
    }
  }

  return processed;
}
