/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { render } from 'svelte/server';
import { parsePrismaSchema, type PrismaSchema, type PrismaModel } from './introspection/parser.js';
import { parseRoute } from './router.js';
import {
  primaryKeyOf,
  toPrismaModel,
  formDataToPrisma,
  paginate,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord
} from './data.js';
import { escapeHtml, toLabel } from './views/html.js';
import { listView } from './views/list.js';
import NotFound from './views/NotFound.svelte';
import Layout from './views/Layout.svelte';
import Dashboard from './views/Dashboard.svelte';
import Form from './views/Form.svelte';

const PER_PAGE = 20;

export interface AdminHandlerConfig {
  /** Prisma client instance */
  prisma: any;
  /** Path to Prisma schema file */
  prismaSchemaPath?: string;
  /** Base path for admin routes (default: /admin) */
  basePath?: string;
  /** Authentication check - return true if user can access admin */
  authCheck?: (event: any) => boolean | Promise<boolean>;
  /** Per-model configuration */
  models?: Record<string, {
    hidden?: string[];
    readonly?: string[];
    listFields?: string[];
    label?: string;
  }>;
  /** Models to exclude from admin */
  exclude?: string[];
  /** Hide pivot/junction tables automatically (default: true) */
  hidePivotTables?: boolean;
  /** Custom branding */
  branding?: {
    title?: string;
    primaryColor?: string;
  };
}

// ============================================
// Main Handler
// ============================================

export function createAdminHandler(config: AdminHandlerConfig) {
  const {
    prisma,
    prismaSchemaPath = './prisma/schema.prisma',
    basePath = '/admin',
    authCheck,
    exclude = [],
    hidePivotTables = true,
    models: modelsConfig = {}
  } = config;

  // Parse schema once at startup
  let schema: PrismaSchema | null = null;
  try {
    schema = parsePrismaSchema(prismaSchemaPath);
  } catch (e) {
    console.warn('[sveltekit-admin] Could not parse Prisma schema:', e);
  }

  const filteredModels = schema?.models.filter((m) => {
    // Exclude explicitly excluded models
    if (exclude.includes(m.name)) return false;
    // Exclude pivot tables if option is enabled
    if (hidePivotTables && m.isPivotTable) return false;
    return true;
  }) || [];
  const labelOf = (m: PrismaModel) => modelsConfig[m.name]?.label || toLabel(m.name);
  const modelList = filteredModels.map((m) => ({ name: m.name, label: labelOf(m) }));
  const findModel = (name?: string) =>
    filteredModels.find((m) => m.name.toLowerCase() === name?.toLowerCase());
  const viewModel = (m: PrismaModel) => ({
    name: m.name,
    label: labelOf(m),
    fields: m.fields,
    primaryKey: primaryKeyOf(m)
  });
  const redirectToList = (model: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${basePath}/${model.toLowerCase()}` }
    });

  return async ({
    event,
    resolve
  }: {
    event: any;
    resolve: (event: any) => Response | Promise<Response>;
  }) => {
    const { pathname } = event.url;

    // Only handle admin routes
    if (!pathname.startsWith(basePath)) {
      return resolve(event);
    }

    // Auth check
    if (authCheck) {
      const allowed = await authCheck(event);
      if (!allowed) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    const route = parseRoute(pathname, basePath);
    let content = '';
    let currentModel: string | undefined;

    try {
      // Handle POST requests (create, update, delete). Unrecognised actions fall
      // through to the GET rendering below, as they always have.
      if (event.request.method === 'POST') {
        const formData = await event.request.formData();
        const action = formData.get('_action');

        if (route.model) {
          const model = findModel(route.model);
          if (!model) {
            throw new Error(`Model "${route.model}" not found`);
          }

          if (action === 'delete' && route.id) {
            await deleteRecord(prisma, model, route.id);
            return redirectToList(route.model);
          }

          if (action === 'create' || action === 'update') {
            const data = formDataToPrisma(formData, model);

            if (action === 'create') {
              await createRecord(prisma, model, data);
            } else if (route.id) {
              await updateRecord(prisma, model, route.id, data);
            }

            return redirectToList(route.model);
          }
        }
      }

      // GET requests - render views
      if (route.view === 'notFound') {
        content = render(NotFound, { props: { message: 'Page not found', basePath } }).body;
      } else if (route.view === 'dashboard') {
        const modelsWithCounts = await Promise.all(
          filteredModels.map(async (m) => {
            let count = 0;
            try {
              count = await prisma[toPrismaModel(m.name)].count();
            } catch {
              // model absent from the database
            }
            return { name: m.name, label: labelOf(m), count };
          })
        );

        const totalRecords = modelsWithCounts.reduce((sum, m) => sum + m.count, 0);

        content = render(Dashboard, {
          props: {
            models: modelsWithCounts,
            stats: { total: totalRecords, models: modelsWithCounts.length },
            basePath
          }
        }).body;
      } else if (route.model) {
        currentModel = route.model;
        const model = findModel(route.model);

        if (!model) {
          content = render(NotFound, {
            props: { message: `Model "${route.model}" not found`, basePath }
          }).body;
        } else if (route.view === 'list') {
          const { page } = paginate(event.url.searchParams.get('page'), PER_PAGE);
          const { items, total } = await listRecords(prisma, model, page, PER_PAGE);
          content = listView(
            viewModel(model),
            items,
            { page, perPage: PER_PAGE, total },
            basePath,
            config
          );
        } else if (route.view === 'create') {
          content = render(Form, { props: { mode: 'create', model: viewModel(model), basePath, config } }).body;
        } else {
          // `route.id!` s'appuie sur un invariant de `parseRoute` : les seules vues
          // qui portent un `model` sont 'list', 'create' et 'edit', et seule 'edit'
          // atteint ce `else` — or 'edit' est la branche à 2 segments, donc `id` y est
          // toujours défini. La variante 'notFound' ne porte pas de `model` : elle est
          // interceptée en amont et ne peut pas arriver ici.
          const item = await getRecord(prisma, model, route.id!);
          content = item
            ? render(Form, { props: { mode: 'edit', model: viewModel(model), basePath, config, item } }).body
            : render(NotFound, {
                props: { message: `${model.name} with ID "${route.id}" not found`, basePath }
              }).body;
        }
      }
    } catch (e: any) {
      console.error('[sveltekit-admin] Error:', e);
      content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }

    const html = render(Layout, { props: { content, config, modelList, currentModel } }).body;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  };
}
