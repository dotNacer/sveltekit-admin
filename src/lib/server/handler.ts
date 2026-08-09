/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { render } from 'svelte/server';
import { parsePrismaSchema, type PrismaSchema, type PrismaModel } from './introspection/parser.js';
import { buildRelationGraph, type RelationGraph } from './introspection/relations.js';
import { parseRoute } from './router.js';
import {
  primaryKeyOf,
  toPrismaModel,
  coerceId,
  formDataToPrisma,
  paginate,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord
} from './data.js';
import { escapeHtml, toLabel } from './views/html.js';
import NotFound from './views/NotFound.svelte';
import Layout from './views/Layout.svelte';
import Dashboard from './views/Dashboard.svelte';
import Form from './views/Form.svelte';
import List from './views/List.svelte';
import type { ViewModel } from './views/types.js';

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
    relations?: Record<string, {
      widget?: 'select' | 'raw-id' | 'hidden';
      labelTemplate?: string;
      orderBy?: Record<string, 'asc' | 'desc'>;
      where?: (ctx: { locals?: any }) => Record<string, unknown>;
      nullLabel?: string;
    }>;
  }>;
  /** Models to exclude from admin */
  exclude?: string[];
  /** Hide pivot/junction tables automatically (default: true) */
  hidePivotTables?: boolean;
  /** Relation defaults */
  relationDefaults?: {
    /** Au-delà de ce nombre d'options, une FK est rendue en raw-id (default: 200) */
    selectThreshold?: number;
    /** Champs candidats pour le label, dans l'ordre de préférence */
    labelFields?: string[];
  };
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
  let relationGraph: RelationGraph | null = null;
  try {
    schema = parsePrismaSchema(prismaSchemaPath);
    relationGraph = buildRelationGraph(schema);
    for (const d of relationGraph.diagnostics) {
      console.warn(`[sveltekit-admin] ${d}`);
    }
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
  const viewModel = (m: PrismaModel): ViewModel => ({
    name: m.name,
    label: labelOf(m),
    fields: m.fields,
    primaryKey: primaryKeyOf(m),
    // Non-null par construction : `m` vient toujours de `filteredModels`,
    // dérivé du schéma qu'on vient de parser avec succès.
    relationGraph: relationGraph!
  });
  const redirectToList = (model: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${basePath}/${model.toLowerCase()}` }
    });

  const selectThreshold = config.relationDefaults?.selectThreshold ?? 200;
  const labelFieldCandidates = config.relationDefaults?.labelFields ?? [
    'name', 'title', 'label', 'email', 'username', 'slug'
  ];

  /**
   * Résout le label BRUT (non échappé) d'une ligne : premier champ String
   * candidat présent, sinon template `{a} {b}` si configuré, sinon la PK.
   * Déterministe. Svelte échappe automatiquement à l'interpolation dans les
   * composants — pas besoin d'échapper ici.
   */
  const resolveLabel = (
    targetModel: PrismaModel,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string => {
    if (labelTemplate) {
      return labelTemplate.replace(/\{(\w+)\}/g, (_, k) => String(row[k] ?? ''));
    }
    for (const candidate of labelFieldCandidates) {
      const field = targetModel.fields.find((f) => f.name === candidate);
      if (field && field.type === 'String' && row[candidate] != null) {
        return String(row[candidate]);
      }
    }
    return String(row[primaryKeyOf(targetModel)]);
  };

  /**
   * Charge les options pour toutes les arêtes to-one-owning et m2m-implicite
   * d'un modèle. Une requête COUNT par relation avant le findMany : évite de
   * charger 10k lignes pour découvrir qu'il y en a 10k.
   */
  const loadRelationOptions = async (
    model: PrismaModel,
    ctx: { locals?: any },
    currentId?: string
  ): Promise<Map<string, import('./views/types.js').RelationMeta>> => {
    const out = new Map<string, import('./views/types.js').RelationMeta>();
    for (const edge of relationGraph!.edges.values()) {
      if (edge.model !== model.name) continue;
      if (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m-implicit') continue;
      if (edge.unsupported) continue;

      const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
      if (relConfig?.widget === 'hidden') continue;

      const targetModel = schema!.models.find((m) => m.name === edge.target)!;
      const where = relConfig?.where ? relConfig.where(ctx) : undefined;
      const prismaKey = toPrismaModel(edge.target);

      try {
        const total: number = await prisma[prismaKey].count({ where });
        if (total > selectThreshold || relConfig?.widget === 'raw-id') {
          const selectedIds =
            edge.kind === 'm2m-implicit' && currentId
              ? await loadSelectedIds(model, edge, currentId, targetModel)
              : undefined;
          out.set(`${edge.model}.${edge.field}`, { tooMany: true, options: [], selectedIds });
          continue;
        }

        const rows: Record<string, unknown>[] = await prisma[prismaKey].findMany({
          where,
          orderBy: relConfig?.orderBy
        });
        const options = rows.map((row) => ({
          id: row[primaryKeyOf(targetModel)] as string | number,
          label: resolveLabel(targetModel, row, relConfig?.labelTemplate)
        }));
        const selectedIds =
          edge.kind === 'm2m-implicit' && currentId
            ? await loadSelectedIds(model, edge, currentId, targetModel)
            : undefined;
        out.set(`${edge.model}.${edge.field}`, { tooMany: false, options, selectedIds });
      } catch {
        // Cible absente de la base ou client incomplet : repli raw-id pour
        // garder le champ éditable plutôt que de faire échouer tout le form.
        out.set(`${edge.model}.${edge.field}`, { tooMany: true, options: [] });
      }
    }
    return out;
  };

  /** IDs liés côté N-N implicite, via une requête sur le join field Prisma. */
  const loadSelectedIds = async (
    model: PrismaModel,
    edge: import('./introspection/relations.js').RelationEdge,
    currentId: string,
    targetModel: PrismaModel
  ): Promise<(string | number)[]> => {
    try {
      const current = await prisma[toPrismaModel(model.name)].findUnique({
        where: { [primaryKeyOf(model)]: coerceId(currentId, model) },
        include: { [edge.field]: true }
      });
      const linked: Record<string, unknown>[] = current?.[edge.field] ?? [];
      return linked.map((row) => row[primaryKeyOf(targetModel)] as string | number);
    } catch {
      return [];
    }
  };

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

            // Validation des FK owning : coercion + existence + self-ref.
            // Rejoue le `where` de scoping : un ID hors du where est rejeté,
            // pas seulement caché du select (IDOR par POST forgé).
            if (relationGraph) {
              for (const edge of relationGraph.edges.values()) {
                if (edge.model !== model.name || edge.kind !== 'to-one-owning') continue;
                if (edge.unsupported) continue;

                const scalarName = edge.scalarFields[0]!;
                // Lu directement depuis le FormData plutôt que `data` :
                // `formDataToPrisma` omet la clé pour un scalaire required
                // laissé vide, donc `data[scalarName]` ne suffirait pas ici.
                const raw = formData.get(scalarName);
                if (raw === null) continue;

                const relConfig = modelsConfig[model.name]?.relations?.[edge.field];

                // Vide sur relation optionnelle → null (disconnect).
                if (raw === '' || raw === undefined || raw === null) {
                  if (edge.isRequired) {
                    throw new Error(`${edge.field} is required`);
                  }
                  data[scalarName] = null;
                  continue;
                }

                // Coercion vers le type de la PK cible. `targetModel` existe
                // toujours : le graphe n'aurait pas produit d'arête sinon.
                const targetModel = schema!.models.find((m) => m.name === edge.target)!;
                const pkField = targetModel.fields.find((f) => f.isId);
                const coerced = pkField?.type === 'Int' ? parseInt(String(raw)) : String(raw);
                if (pkField?.type === 'Int' && !Number.isSafeInteger(coerced)) {
                  throw new Error(`${edge.field}: invalid id`);
                }

                // Self-ref : la ligne courante ne peut pas être sa propre cible.
                if (edge.selfReferential && route.id && String(coerced) === String(coerceId(route.id, model))) {
                  throw new Error(`${edge.field}: cannot reference itself`);
                }

                // Existence + scoping. findFirst et non findUnique : le where
                // peut porter des conditions arbitraires (scoping multi-tenant).
                // Si le client ne sait pas répondre, on ne bloque pas l'écriture.
                try {
                  const where: Record<string, unknown> = {
                    [primaryKeyOf(targetModel)]: coerced,
                    ...(relConfig?.where ? relConfig.where({ locals: event.locals }) : {})
                  };
                  const found = await prisma[toPrismaModel(edge.target)].findFirst({ where });
                  if (!found) {
                    throw new Error(`${edge.field}: invalid value`);
                  }
                } catch (e: any) {
                  if (e?.message?.includes('invalid value')) throw e;
                  // Client incapable de vérifier (mock partiel, etc.) : on laisse passer.
                }

                data[scalarName] = coerced;
              }

              // N-N implicite : lit `__rel__<field>` (valeurs cochées) et
              // `__rel_present__<field>` (sentinelle). Sans le sentinelle,
              // le champ est absent du form (readonly/exclu) → no-op.
              // Avec le sentinelle mais zéro valeur cochée → vider la
              // relation (`set: []` / rien à connecter en création).
              for (const edge of relationGraph.edges.values()) {
                if (edge.model !== model.name || edge.kind !== 'm2m-implicit') continue;
                // Pas de garde `edge.unsupported` ici : par construction du
                // graphe, `unsupported` n'est jamais posé sur une arête
                // m2m-implicite (seulement sur to-one-owning / groupes
                // ambigus, qui retombent toujours en to-one-owning).

                const present = formData.get(`__rel_present__${edge.field}`);
                if (present === null) continue;

                const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
                const targetModel = schema!.models.find((m) => m.name === edge.target)!;
                const targetPk = primaryKeyOf(targetModel);
                const pkIsInt = targetModel.fields.find((f) => f.isId)?.type === 'Int';

                const submitted = formData.getAll(`__rel__${edge.field}`).map(String);
                const rawIds: string[] =
                  submitted.length === 1 && submitted[0].includes(',')
                    ? submitted[0].split(',').map((s: string) => s.trim()).filter(Boolean)
                    : submitted;

                const ids: (string | number)[] = rawIds.map((v: string) =>
                  pkIsInt ? parseInt(v) : v
                );
                if (pkIsInt && ids.some((v) => !Number.isSafeInteger(v))) {
                  throw new Error(`${edge.field}: invalid id`);
                }

                // Existence + scoping en une requête, sur l'ensemble des IDs
                // soumis. Un compte différent = au moins un ID invalide ou
                // hors scoping — IDOR bloqué au même titre que pour les FK.
                if (ids.length > 0) {
                  const where: Record<string, unknown> = {
                    [targetPk]: { in: ids },
                    ...(relConfig?.where ? relConfig.where({ locals: event.locals }) : {})
                  };
                  try {
                    const found: unknown[] = await prisma[toPrismaModel(edge.target)].findMany({ where });
                    if (found.length !== new Set(ids.map(String)).size) {
                      throw new Error(`${edge.field}: invalid value`);
                    }
                  } catch (e: any) {
                    if (e?.message?.includes('invalid value')) throw e;
                    // Client incapable de vérifier : on laisse passer.
                  }
                }

                const idRefs = ids.map((id: string | number) => ({ [targetPk]: id }));
                data[edge.field] =
                  action === 'create' ? { connect: idRefs } : { set: idRefs };
              }
            }

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
          content = render(List, {
            props: {
              model: viewModel(model),
              items,
              pagination: { page, perPage: PER_PAGE, total },
              basePath,
              config
            }
          }).body;
        } else if (route.view === 'create') {
          const relationOptions = await loadRelationOptions(model, { locals: event.locals });
          content = render(Form, {
            props: { mode: 'create', model: { ...viewModel(model), relationOptions }, basePath, config }
          }).body;
        } else {
          // `route.id!` s'appuie sur un invariant de `parseRoute` : les seules vues
          // qui portent un `model` sont 'list', 'create' et 'edit', et seule 'edit'
          // atteint ce `else` — or 'edit' est la branche à 2 segments, donc `id` y est
          // toujours défini. La variante 'notFound' ne porte pas de `model` : elle est
          // interceptée en amont et ne peut pas arriver ici.
          const item = await getRecord(prisma, model, route.id!);
          const relationOptions = await loadRelationOptions(model, { locals: event.locals }, route.id);
          content = item
            ? render(Form, {
                props: { mode: 'edit', model: { ...viewModel(model), relationOptions }, basePath, config, item }
              }).body
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
