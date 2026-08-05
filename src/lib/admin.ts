/**
 * SvelteKit Admin - Core Admin Factory
 * Creates all the necessary handlers for the admin panel
 */

import { 
  parsePrismaSchema, 
  getDisplayFields, 
  getEditableFields,
  getInputType,
  fieldToLabel,
  type PrismaSchema, 
  type PrismaModel 
} from './server/introspection/parser.js';
import {
  createListOperation,
  createGetOperation,
  createCreateOperation,
  createUpdateOperation,
  createDeleteOperation,
  type ListOptions
} from './server/crud/operations.js';
import { defaultAdminCheck } from './server/auth/guard.js';

export interface AdminConfig {
  /** Prisma client instance */
  prisma: any;
  /** Path to Prisma schema file */
  schemaPath?: string;
  /** Parsed schema (alternative to schemaPath) */
  schema?: PrismaSchema;
  /** Base path for admin (default: /admin) */
  basePath?: string;
  /** Models to exclude */
  exclude?: string[];
  /** Per-model configuration */
  models?: Record<string, {
    hidden?: string[];
    readonly?: string[];
    listFields?: string[];
    label?: string;
  }>;
  /** Branding options */
  branding?: {
    title?: string;
    logo?: string;
    primaryColor?: string;
  };
  /** Auth check function */
  checkAdmin?: (user: unknown) => boolean | Promise<boolean>;
  /** Admin role name (if using default check) */
  adminRole?: string;
}

export interface AdminContext {
  config: AdminConfig;
  schema: PrismaSchema;
  models: PrismaModel[];
  getModel: (name: string) => PrismaModel | undefined;
}

/**
 * Create admin context with all necessary data
 */
export function createAdmin(config: AdminConfig): AdminContext {
  // Parse schema if not provided
  let schema = config.schema;
  if (!schema && config.schemaPath) {
    schema = parsePrismaSchema(config.schemaPath);
  }
  if (!schema) {
    throw new Error('Either schema or schemaPath must be provided');
  }

  // Filter excluded models
  const exclude = config.exclude || [];
  const models = schema.models.filter(m => !exclude.includes(m.name));

  return {
    config,
    schema,
    models,
    getModel: (name: string) => models.find(
      m => m.name.toLowerCase() === name.toLowerCase()
    )
  };
}

/**
 * Layout data loader - provides models list and config to layout
 */
export function createLayoutLoad(ctx: AdminContext) {
  return async ({ locals }: { locals: any }) => {
    const user = locals.user;
    
    return {
      models: ctx.models.map(m => ({
        name: m.name,
        label: ctx.config.models?.[m.name]?.label || m.name
      })),
      user: user ? { name: user.name, email: user.email } : undefined,
      config: {
        basePath: ctx.config.basePath || '/admin',
        branding: {
          title: ctx.config.branding?.title || 'Admin',
          logo: ctx.config.branding?.logo,
          primaryColor: ctx.config.branding?.primaryColor || '#6366f1'
        }
      }
    };
  };
}

/**
 * Dashboard data loader - provides model counts
 */
export function createDashboardLoad(ctx: AdminContext) {
  return async () => {
    const modelCounts = await Promise.all(
      ctx.models.map(async (model) => {
        const modelKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
        const prismaModel = ctx.config.prisma[modelKey];
        let count = 0;
        
        if (prismaModel?.count) {
          try {
            count = await prismaModel.count();
          } catch (e) {
            // Model might not exist in DB yet
          }
        }
        
        return {
          name: model.name,
          label: ctx.config.models?.[model.name]?.label || model.name,
          count
        };
      })
    );

    const totalRecords = modelCounts.reduce((sum, m) => sum + m.count, 0);

    return {
      models: modelCounts,
      stats: {
        totalRecords,
        modelsCount: ctx.models.length
      }
    };
  };
}

/**
 * Model list data loader
 */
export function createModelListLoad(ctx: AdminContext) {
  return async ({ params, url }: { params: { model: string }; url: URL }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const modelConfig = ctx.config.models?.[model.name] || {};
    const hidden = modelConfig.hidden || [];

    // Parse query params
    const page = parseInt(url.searchParams.get('page') || '1');
    const perPage = parseInt(url.searchParams.get('perPage') || '20');
    const search = url.searchParams.get('search') || '';
    const orderBy = url.searchParams.get('orderBy') || model.primaryKey || 'id';
    const orderDir = (url.searchParams.get('orderDir') || 'desc') as 'asc' | 'desc';

    // Get display fields
    let displayFields = getDisplayFields(model).filter(f => !hidden.includes(f.name));
    if (modelConfig.listFields?.length) {
      displayFields = displayFields.filter(f => modelConfig.listFields!.includes(f.name));
    }

    // Execute list query
    const listOp = createListOperation(model);
    const result = await listOp.execute(ctx.config.prisma, {
      page,
      perPage,
      search,
      orderBy,
      orderDir
    });

    return {
      model: {
        name: model.name,
        label: modelConfig.label || model.name,
        fields: displayFields.map(f => ({
          name: f.name,
          type: f.type,
          label: fieldToLabel(f.name)
        })),
        primaryKey: model.primaryKey || 'id'
      },
      items: result.items,
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      orderBy,
      orderDir,
      search,
      config: {
        basePath: ctx.config.basePath || '/admin',
        hidden,
        listFields: modelConfig.listFields
      }
    };
  };
}

/**
 * Model create page loader
 */
export function createModelNewLoad(ctx: AdminContext) {
  return async ({ params }: { params: { model: string } }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const modelConfig = ctx.config.models?.[model.name] || {};
    const hidden = modelConfig.hidden || [];
    const readonly = modelConfig.readonly || [];

    const editableFields = getEditableFields(model).filter(f => !hidden.includes(f.name));

    // Load relation options
    const relationOptions: Record<string, Array<{ id: string | number; label: string }>> = {};
    for (const field of editableFields) {
      if (field.relation) {
        const relatedModel = ctx.getModel(field.relation.model);
        if (relatedModel) {
          const relKey = field.relation.model.charAt(0).toLowerCase() + field.relation.model.slice(1);
          const relPrisma = ctx.config.prisma[relKey];
          if (relPrisma?.findMany) {
            try {
              const items = await relPrisma.findMany({ take: 100 });
              relationOptions[field.name] = items.map((item: any) => ({
                id: item.id,
                label: item.name || item.title || item.email || String(item.id)
              }));
            } catch (e) {
              // Ignore errors
            }
          }
        }
      }
    }

    return {
      model: {
        name: model.name,
        label: modelConfig.label || model.name,
        fields: editableFields.map(f => ({
          name: f.name,
          type: f.type,
          required: f.isRequired && !f.hasDefault,
          label: fieldToLabel(f.name)
        }))
      },
      config: {
        basePath: ctx.config.basePath || '/admin',
        hidden,
        readonly
      },
      relationOptions
    };
  };
}

/**
 * Model create action
 */
export function createModelNewAction(ctx: AdminContext) {
  return async ({ params, request }: { params: { model: string }; request: Request }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const formData = await request.formData();
    const data: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      data[key] = value;
    });

    const createOp = createCreateOperation(model);
    
    try {
      await createOp.execute(ctx.config.prisma, data);
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message,
        fieldErrors: {} 
      };
    }
  };
}

/**
 * Model edit page loader
 */
export function createModelEditLoad(ctx: AdminContext) {
  return async ({ params }: { params: { model: string; id: string } }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const modelConfig = ctx.config.models?.[model.name] || {};
    const hidden = modelConfig.hidden || [];
    const readonly = modelConfig.readonly || [];

    // Get the record
    const getOp = createGetOperation(model);
    const item = await getOp.execute(ctx.config.prisma, params.id);
    
    if (!item) {
      throw new Error(`Record not found`);
    }

    const allFields = model.fields.filter(f => !hidden.includes(f.name));

    // Load relation options for editable relation fields
    const relationOptions: Record<string, Array<{ id: string | number; label: string }>> = {};
    for (const field of allFields) {
      if (field.relation && !field.isList) {
        const relatedModel = ctx.getModel(field.relation.model);
        if (relatedModel) {
          const relKey = field.relation.model.charAt(0).toLowerCase() + field.relation.model.slice(1);
          const relPrisma = ctx.config.prisma[relKey];
          if (relPrisma?.findMany) {
            try {
              const items = await relPrisma.findMany({ take: 100 });
              relationOptions[field.name] = items.map((item: any) => ({
                id: item.id,
                label: item.name || item.title || item.email || String(item.id)
              }));
            } catch (e) {
              // Ignore errors
            }
          }
        }
      }
    }

    return {
      model: {
        name: model.name,
        label: modelConfig.label || model.name,
        primaryKey: model.primaryKey || 'id',
        fields: allFields.map(f => ({
          name: f.name,
          type: f.type,
          required: f.isRequired,
          label: fieldToLabel(f.name)
        }))
      },
      item,
      config: {
        basePath: ctx.config.basePath || '/admin',
        hidden,
        readonly
      },
      relationOptions
    };
  };
}

/**
 * Model update action
 */
export function createModelEditAction(ctx: AdminContext) {
  return async ({ params, request }: { params: { model: string; id: string }; request: Request }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const formData = await request.formData();
    const data: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      data[key] = value;
    });

    const updateOp = createUpdateOperation(model);
    
    try {
      await updateOp.execute(ctx.config.prisma, params.id, data);
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  };
}

/**
 * Model delete action
 */
export function createModelDeleteAction(ctx: AdminContext) {
  return async ({ params, request }: { params: { model: string }; request: Request }) => {
    const model = ctx.getModel(params.model);
    if (!model) {
      throw new Error(`Model ${params.model} not found`);
    }

    const formData = await request.formData();
    const id = formData.get('id');

    if (!id) {
      throw new Error('Missing ID');
    }

    const deleteOp = createDeleteOperation(model);
    
    try {
      await deleteOp.execute(ctx.config.prisma, String(id));
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  };
}

/**
 * Auth guard hook
 */
export function createAdminGuard(ctx: AdminContext) {
  const basePath = ctx.config.basePath || '/admin';
  
  return async ({ event, resolve }: { event: any; resolve: Function }) => {
    if (!event.url.pathname.startsWith(basePath)) {
      return resolve(event);
    }

    const user = event.locals.user;
    
    if (!user) {
      return new Response(null, {
        status: 302,
        headers: { Location: '/login' }
      });
    }

    const checkFn = ctx.config.checkAdmin || 
      ((u: unknown) => defaultAdminCheck(u, ctx.config.adminRole || 'admin'));
    
    const isAdmin = await checkFn(user);
    
    if (!isAdmin) {
      return new Response('Forbidden', { status: 403 });
    }

    return resolve(event);
  };
}
