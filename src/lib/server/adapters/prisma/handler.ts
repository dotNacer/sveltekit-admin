import {
  createAdminHandler as createCoreHandler,
  type AdminHandlerConfig as CoreAdminHandlerConfig
} from '../../handler.js';
import type { Schema } from '../../types/schema.js';
import { createPrismaDataAdapter } from './dataAdapter.js';
import { createPrismaIntrospector } from './introspector.js';
import { resolveCaseInsensitiveSearch } from './index.js';

export interface AdminHandlerConfig
  extends Omit<CoreAdminHandlerConfig, 'adapter' | 'prisma' | 'prismaSchemaPath' | 'search'> {
  prisma?: any;
  prismaSchemaPath?: string;
  adapter?: CoreAdminHandlerConfig['adapter'];
  search?: {
    mode?: 'auto' | 'insensitive' | 'default';
  };
}

function omitPrismaShortcutFields(
  config: AdminHandlerConfig
): Omit<AdminHandlerConfig, 'prisma' | 'prismaSchemaPath' | 'search' | 'adapter'> {
  const { prisma: _prisma, prismaSchemaPath: _path, search: _search, adapter: _adapter, ...rest } =
    config;
  return rest;
}

function buildPrismaAdapter(config: AdminHandlerConfig): NonNullable<CoreAdminHandlerConfig['adapter']> {
  const schemaPath = config.prismaSchemaPath ?? './prisma/schema.prisma';
  const introspector = createPrismaIntrospector({ schemaPath });
  let schema: Schema | null = null;
  try {
    schema = introspector.introspect() as Schema;
  } catch {
    schema = null;
  }
  return {
    introspector: schema ? { introspect: () => schema } : introspector,
    data: createPrismaDataAdapter(config.prisma, {
      caseInsensitiveSearch: resolveCaseInsensitiveSearch(schema, config.search?.mode)
    })
  };
}

export function createAdminHandler(config: AdminHandlerConfig) {
  if (config.adapter) {
    return createCoreHandler({ ...omitPrismaShortcutFields(config), adapter: config.adapter });
  }
  if (!config.prisma) {
    throw new Error(
      '[sveltekit-admin] createAdminHandler requires either `prisma` (with optional `prismaSchemaPath`) or `adapter` — neither was provided.'
    );
  }
  return createCoreHandler({
    ...omitPrismaShortcutFields(config),
    adapter: buildPrismaAdapter(config)
  });
}
