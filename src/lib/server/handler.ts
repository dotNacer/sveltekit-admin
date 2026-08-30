/**
 * SvelteKit Admin - Standalone Handler
 * Zero files needed in routes - everything handled via hook
 */

import { render } from 'svelte/server';
import { matchRoute, BUILTIN_ROUTES, type ParsedRoute } from './router.js';
import { paginate, coerceId } from './data.js';
import {
  parseListQuery,
  buildWhere,
  resolveSearchFields
} from './query/listQuery.js';
import { normalizeScope } from './adapters/filter.js';
import type { DataAdapter, SchemaIntrospector } from './adapters/types.js';
import { resolveListFilters } from './query/filterDetection.js';
import { escapeHtml, toLabel } from './views/html.js';
import type { AuditEvent } from './audit.js';
import type { FkFilterMeta } from './views/types.js';
import NotFound from './views/NotFound.svelte';
import Layout from './views/Layout.svelte';
import Dashboard from './views/Dashboard.svelte';
import Form from './views/Form.svelte';
import List from './views/List.svelte';
import { createAdminRuntime, listScopeFrom, modelScopeFrom } from './runtime.js';
import { loadRelationOptions, resolveFkFilterOptions, loadRelatedCounts } from './relationLoaders.js';
import { handleSearch } from './search.js';
import { handleMutation } from './mutations.js';
import { verifyOrigin, resolveCsrfConfig, type CsrfConfig } from './csrf.js';
import { resolvePluginRegistry, actionsForModel } from './pluginRegistry.js';
import { createPluginPageContext } from './pluginAccess.js';
import type { AdminPlugin } from './plugin.js';

export interface AdminHandlerConfig {
  /**
   * Explicit `{ introspector, data }` pair, from `createPrismaAdapter`,
   * `createDrizzleAdapter`, or a custom implementation. The `{ prisma,
   * prismaSchemaPath }` shortcut lives on the Prisma wrapper exported by
   * the package root, not here.
   */
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
  /** Base path for admin routes (default: /admin) */
  basePath?: string;
  /** Authentication check - return true if user can access admin */
  authCheck?: (event: any) => boolean | Promise<boolean>;
  /**
   * Logout logic — same "bring your own auth" philosophy as `authCheck`:
   * this library has no session system of its own, so it can't know how
   * to clear yours (a cookie, a Lucia/Better-Auth/Auth.js call, whatever).
   * You provide the side effect (clear the cookie, invalidate the
   * session...); the handler wires it to a POST-only route and a sidebar
   * button. No button is rendered at all if this isn't set — an admin
   * with no `logout` configured looks exactly as it did before this
   * option existed.
   *
   * POST-only, never a bare link: logging out must never be triggerable
   * by a GET (a crawler, a link prefetch, `<img src>`), which a plain
   * `<a href="/admin/_logout">` would allow. Runs BEFORE `authCheck` — a
   * user whose session already expired (so `authCheck` would now reject
   * them) must still be able to hit the logout route to clean up
   * client-side state (e.g. clear a stale cookie) without being stuck
   * behind a 401 first.
   */
  logout?: (event: any) => void | Promise<void>;
  /** Where to redirect after logout (default: '/') */
  logoutRedirectTo?: string;
  /**
   * Cross-site protection for every state-changing admin request (create /
   * update / delete, `_logout`, `_search`). On by default; a missing `Origin`
   * is rejected, as SvelteKit does. `trustedOrigins` allows a second
   * legitimate origin, `csrf: false` opts out entirely.
   *
   * Why this isn't left to `kit.csrf.checkOrigin`, and the same-origin threat
   * it does not cover: see `csrf.ts` and /docs/csrf.
   */
  csrf?: CsrfConfig;
  /**
   * Audit sink — same "bring your own" philosophy as `authCheck` / `logout`.
   * The library has no log table and no session of its own, so it cannot
   * know where to persist "admin X changed row Y" (your `AuditLog` model,
   * a logger, an HTTP sink…). You provide the side effect; the handler
   * calls it **after a successful create / update / delete** with a
   * redacted `AuditEvent`. No callback means no behaviour change: no
   * extra reads, no calls.
   *
   * The actor is whatever you already put on `event.locals` (the same
   * object `authCheck` sees). Sensitive field names (`password` / `hash` /
   * `secret` / `token`) and per-model `hidden` fields are stripped from
   * `values` / `before` / `after` / `changes` so the sink cannot become a
   * second oracle for secrets. Reads (GET), logout, and `_search` are
   * not audited.
   *
   * Awaited before the 303 so a `prisma.auditLog.create(...)` inside the
   * callback commits before the redirect. If the callback throws, the
   * mutation still redirects — the write is the source of truth, the log
   * is a sidecar (`console.error` with prefix
   * `[sveltekit-admin] audit callback failed:`). There is no way to wrap
   * the adapter write and your sink in one transaction without owning
   * both stores.
   */
  audit?: (entry: AuditEvent) => void | Promise<void>;
  /** Per-model configuration */
  models?: Record<string, {
    hidden?: string[];
    readonly?: string[];
    listFields?: string[];
    label?: string;
    scope?: (ctx: { locals?: any }) => Record<string, unknown> | import('./adapters/types.js').Filter;
    /**
     * Scoping `where` applied to the LIST VIEW ONLY of this model
     * (search, sidebar filters, FK filter, pagination count) — composed
     * via `AND` with active filters, never a spread (docs/design
     * §0.c/§5.2). Deliberately named `listWhere`, not `where`: a bare
     * `where` invites a developer to believe it scopes every operation
     * on the model (detail view, edit, delete, dashboard counts), which
     * it does NOT — those have no equivalent scoping in this version and
     * remain fully open regardless of this config (a real risk found in
     * review: a multi-tenant app that relies on `listWhere` alone gets a
     * false sense of safety while `getRecord`/`updateRecord`/
     * `deleteRecord` stay unscoped for anyone who obtains a row's ID
     * through another channel — a referrer, a log line, or straight
     * enumeration on a model with an Int primary key).
     *
     * Without this scope, the FK filter this feature adds makes
     * cross-tenant row discovery through the list trivial: `?f.authorId=
     * 1..N` used to return another tenant's row (its label stayed
     * protected via `relations[x].where`, §6.3.b, but the row itself did
     * not). This config closes that specific hole for the list — nothing
     * more. If you need every view scoped, you currently have to wire
     * `relations[x].where` for the active-FK-label lookup separately
     * (they are NOT the same function and are NOT automatically kept in
     * sync), and there is no scoping hook at all yet for
     * detail/edit/delete/dashboard — track that as a real gap, not an
     * oversight to work around silently.
     *
     * A scope function that returns `{}` (e.g. because `locals.userId`
     * was undefined after a session expired) is NOT treated as "no
     * scope" — `{}` would silently fail open (an intersection with an
     * empty clause matches everything) exactly when a caller most needs
     * protection. It throws instead: fail loud on a misbehaving scope
     * function, never fail open on a data leak.
     */
    listWhere?: (ctx: { locals?: any }) => Record<string, unknown>;
    relations?: Record<string, {
      widget?: 'select' | 'raw-id' | 'hidden';
      labelTemplate?: string;
      orderBy?: Record<string, 'asc' | 'desc'>;
      where?: (ctx: { locals?: any }) => Record<string, unknown>;
      nullLabel?: string;
    }>;
    /**
     * Champs interrogés par la barre de recherche texte libre. Sans
     * config, une heuristique conservatrice reprend `relationDefaults.labelFields`
     * parmi les champs String non sensibles (voir docs/design/list-search-filters.md §2.1).
     * Une config explicite gagne toujours et n'est jamais tronquée par
     * l'heuristique — un champ non filtrable au sens de `isFilterableFieldType`
     * (relation, liste, Json, Bytes) ou sensible (password/hash/secret/token)
     * y est silencieusement ignoré.
     */
    searchFields?: string[];
    /**
     * Champs filtrables via la sidebar de la liste. Config explicite
     * (forme courte `'published'` ou objet `{ field, label }`) — sinon
     * une heuristique auto-détecte les champs Boolean et enum uniquement
     * (domaine de valeurs connu statiquement, zéro requête pour rendre la
     * sidebar ; voir docs/design/list-search-filters.md §3.5). Une config
     * invalide (champ inexistant, sensible, relation, type non supporté)
     * lève une erreur au démarrage — c'est une erreur de développeur, elle
     * doit échouer fort plutôt que produire un filtre silencieusement mort.
     */
    listFilter?: import('./query/filterDetection.js').ListFilterConfigEntry[];
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
  /**
   * Défauts pour la sidebar de filtres (listFilter).
   * `linkThreshold`: en dessous ou égal à ce nombre d'options, un filtre FK
   * est rendu en liens dans la sidebar ; au-dessus (et ≤ relationDefaults.selectThreshold),
   * en `<select>` dans un mini form GET (docs/design/list-search-filters.md §3.2).
   * `autoDetect`: auto-détection des champs Boolean/enum quand pas de config
   * `listFilter` explicite (default: true).
   */
  listFilterDefaults?: {
    linkThreshold?: number;
    autoDetect?: boolean;
  };
  /** Custom branding */
  branding?: {
    title?: string;
    primaryColor?: string;
  };
  /**
   * Optional admin plugins (new pages + record actions). Omitted or `[]`
   * keeps every builtin view byte-identical to a build without plugins.
   * Plugin routes are matched before builtins, so a registered pattern
   * with a literal token in a `:model`/`:id` position can take over a
   * builtin path when it matches first (e.g. `['user']` shadows the User
   * list); only an identical, token-for-token overlay throws at boot.
   * See `AdminPlugin`. Options like graph `depth` belong on the author's
   * factory, not here.
   */
  plugins?: AdminPlugin[];
}

// ============================================
// Main Handler
// ============================================

export function createAdminHandler(config: AdminHandlerConfig) {
  if (!config.adapter) {
    throw new Error('[sveltekit-admin] createAdminHandler requires `adapter`.');
  }

  const runtime = createAdminRuntime(config);
  const csrf = resolveCsrfConfig(config.csrf);
  const registry = resolvePluginRegistry(config.plugins ?? [], BUILTIN_ROUTES, runtime.models);
  const { authCheck, logout, logoutRedirectTo = '/' } = config;

  return async ({
    event,
    resolve
  }: {
    event: any;
    resolve: (event: any) => Response | Promise<Response>;
  }) => {
    const { pathname } = event.url;

    // Only handle admin routes
    if (!pathname.startsWith(runtime.basePath)) {
      return resolve(event);
    }

    // Avant `matchRoute` : couvre le logout (dispatché avant `authCheck`),
    // `_search`, les mutations, et toute route ajoutée plus tard.
    const forbidden = verifyOrigin(csrf, event);
    if (forbidden) return forbidden;

    // Plugin routes are checked BEFORE builtins: `resolvePluginRegistry` only
    // rejects a plugin pattern that is an EXACT token-for-token match of a
    // builtin one (e.g. `[':model', ':id']`), not one that merely happens to
    // overlap at match time (e.g. `[':model', 'stats']` vs the builtin edit
    // route `[':model', ':id']` — both match `user/stats`, ':id' being a
    // wildcard). Checking builtins first would let that generic edit route
    // silently swallow every such plugin page.
    const route = matchRoute(pathname, runtime.basePath, [
      ...registry.routes,
      ...BUILTIN_ROUTES
    ]);

    // Logout: dispatched BEFORE authCheck, deliberately. A user whose
    // session already expired (authCheck would now reject them) must
    // still be able to hit this route to clear client-side state (a
    // stale cookie, for instance) instead of being stuck behind a 401
    // with no way to reach the very thing that would let them log back
    // in cleanly. POST-only: a GET (crawler, link prefetch, <img src>)
    // must never be able to trigger a logout side effect.
    if (route.view === 'logout') {
      if (event.request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      if (logout) {
        await logout(event);
      }
      return new Response(null, { status: 303, headers: { Location: logoutRedirectTo } });
    }

    // Auth check
    if (authCheck) {
      const allowed = await authCheck(event);
      if (!allowed) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (route.view === 'search') {
      return handleSearch(runtime, event);
    }

    // Plugin page views are GET-only: dispatched here, BEFORE `handleMutation`,
    // so a forged POST to a plugin route (e.g. `/user/1/graph` with
    // `_action=delete`) can never reach the mutation path just because its
    // pattern happens to overlap `:model/:id`-shaped segments.
    const pluginPage = registry.pagesByView.get(route.view);
    if (pluginPage) {
      if (event.request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      }
    }

    let content = '';
    let currentModel: string | undefined;
    let extraStyles = '';
    let extraScripts = '';

    try {
      // Handle POST requests (create, update, delete). Unrecognised actions fall
      // through to the GET rendering below, as they always have.
      // Invariant: a plugin view never reaches this call — `pluginPage` above
      // already 405'd any non-GET before this `try` block. `handleMutation`
      // only ever reads `route.model` / `route.id` / the `_action` form
      // field, never `route.view`, so it cannot be confused by a plugin's
      // view id landing here.
      if (event.request.method === 'POST') {
        const mutationResponse = await handleMutation(runtime, event, route as ParsedRoute);
        if (mutationResponse) return mutationResponse;
      }

      // GET requests - render views
      if (pluginPage) {
        const hasModel = pluginPage.pattern.includes(':model');
        const hasId = pluginPage.pattern.includes(':id');
        if (hasModel) {
          currentModel = route.model;
          const model = runtime.findModel(route.model);
          const allowed =
            model &&
            (!pluginPage.models ||
              pluginPage.models.some((n) => n.toLowerCase() === model.name.toLowerCase()));
          if (!model || !allowed) {
            content = render(NotFound, {
              props: { message: 'Page not found', basePath: runtime.basePath }
            }).body;
          } else if (hasId) {
            const ctx = createPluginPageContext(runtime, event, route);
            const loaded = await ctx.loadRecord(model.name, route.id!);
            if (!loaded) {
              content = render(NotFound, {
                props: {
                  message: `${model.name} with ID "${route.id}" not found`,
                  basePath: runtime.basePath
                }
              }).body;
            } else {
              const result = await pluginPage.render(
                createPluginPageContext(runtime, event, route, loaded)
              );
              content = result.html;
              extraStyles = result.styles ?? '';
              extraScripts = result.scripts ?? '';
            }
          } else {
            const result = await pluginPage.render(createPluginPageContext(runtime, event, route));
            content = result.html;
            extraStyles = result.styles ?? '';
            extraScripts = result.scripts ?? '';
          }
        } else {
          const result = await pluginPage.render(createPluginPageContext(runtime, event, route));
          content = result.html;
          extraStyles = result.styles ?? '';
          extraScripts = result.scripts ?? '';
        }
      } else if (route.view === 'notFound') {
        content = render(NotFound, { props: { message: 'Page not found', basePath: runtime.basePath } }).body;
      } else if (route.view === 'dashboard') {
        const modelsWithCounts = await Promise.all(
          runtime.models.map(async (m) => {
            let count = 0;
            try {
              count = await runtime.adapter.data.countRecords(
                m,
                modelScopeFrom(runtime, m, { locals: event.locals })
              );
            } catch {
              // model absent from the database
            }
            return { name: m.name, label: runtime.labelOf(m), count };
          })
        );

        const totalRecords = modelsWithCounts.reduce((sum, m) => sum + m.count, 0);

        content = render(Dashboard, {
          props: {
            models: modelsWithCounts,
            stats: { total: totalRecords, models: modelsWithCounts.length },
            basePath: runtime.basePath
          }
        }).body;
      } else if (route.model) {
        currentModel = route.model;
        const model = runtime.findModel(route.model);

        if (!model) {
          content = render(NotFound, {
            props: { message: `Model "${route.model}" not found`, basePath: runtime.basePath }
          }).body;
        } else if (route.view === 'list') {
          const modelsConfig = runtime.config.models ?? {};
          const { page } = paginate(event.url.searchParams.get('page'), runtime.perPage);
          const modelSearchConfig = modelsConfig[model.name]?.searchFields;
          const searchFields = resolveSearchFields(model, modelSearchConfig, runtime.labelFieldCandidates, runtime.hiddenFieldsOf(model));
          const filterableFields = runtime.resolveFilterableFields(model);
          const listQuery = parseListQuery(
            event.url.searchParams,
            model,
            runtime.schema!.enums,
            searchFields,
            filterableFields
          );
          const listScope = listScopeFrom(runtime, model, { locals: event.locals });
          const modelScope = modelScopeFrom(runtime, model, { locals: event.locals });
          const scope = modelScope && listScope
            ? { op: 'and' as const, clauses: [modelScope, normalizeScope(listScope)!] }
            : modelScope ?? listScope;
          // Adapter compiles case-sensitivity; this arg is unused by buildWhere.
          const filter = buildWhere(listQuery, scope, false, model) as any;
          const { rows: items, total } = await runtime.adapter.data.listRecords(model, { filter, skip: (page - 1) * runtime.perPage, take: runtime.perPage });
          const listFilters = resolveListFilters(
            model,
            runtime.schema!.enums,
            modelsConfig[model.name]?.listFilter,
            toLabel,
            runtime.relationGraph!,
            runtime.hiddenFieldsOf(model),
            runtime.config.listFilterDefaults?.autoDetect ?? true
          );
          // Un filtre FK ne dépend pas de l'autre : résolus en parallèle
          // plutôt qu'un par un (même raisonnement que loadRelationOptions).
          const fkFilterEntries = await Promise.all(
            listFilters
              .filter((filter) => filter.kind === 'fk')
              .map(async (filter): Promise<[string, FkFilterMeta]> => {
                const activeRawValue = listQuery.filters.find(
                  (f) => f.field === filter.field && f.op === 'equals'
                )?.raw;
                const meta = await resolveFkFilterOptions(
                  runtime,
                  model,
                  filter.field,
                  filter.label,
                  { locals: event.locals },
                  activeRawValue
                );
                return [filter.field, meta];
              })
          );
          const fkFilterMeta = new Map(fkFilterEntries);
          content = render(List, {
            props: {
              model: runtime.viewModel(model),
              items,
              pagination: { page, perPage: runtime.perPage, total },
              basePath: runtime.basePath,
              config: runtime.config,
              query: listQuery,
              currentUrl: event.url,
              listFilters,
              fkFilterMeta,
              recordActions: actionsForModel(registry, model.name).map((action) => ({
                label: action.label,
                hrefFor: (id: string | number) =>
                  action.href({ model: model.name, id, basePath: runtime.basePath })
              }))
            }
          }).body;
        } else if (route.view === 'create') {
          const relationOptions = await loadRelationOptions(runtime, model, { locals: event.locals });
          // Pré-remplissage FK depuis la query string (`?authorId=3`), posé
          // par le lien "Ajouter" du bloc de liaisons inverses.
          const prefill: Record<string, unknown> = {};
          for (const edge of runtime.relationGraph!.edges.values()) {
            if (edge.model !== model.name || edge.kind !== 'to-one-owning') continue;
            const scalarName = edge.scalarFields[0];
            const value = event.url.searchParams.get(scalarName);
            if (value !== null) prefill[scalarName] = value;
          }
          const itemPrefill = Object.keys(prefill).length > 0 ? prefill : undefined;
          content = render(Form, {
            props: {
              mode: 'create',
              model: { ...runtime.viewModel(model), relationOptions },
              basePath: runtime.basePath,
              config: runtime.config,
              item: itemPrefill,
              recordActions: []
            }
          }).body;
        } else {
          // `route.id!` s'appuie sur un invariant de `parseRoute` : les seules vues
          // qui portent un `model` sont 'list', 'create' et 'edit', et seule 'edit'
          // atteint ce `else` — or 'edit' est la branche à 2 segments, donc `id` y est
          // toujours défini. La variante 'notFound' ne porte pas de `model` : elle est
          // interceptée en amont et ne peut pas arriver ici.
          const modelScope = modelScopeFrom(runtime, model, { locals: event.locals });
          const item = modelScope
            ? await runtime.adapter.data.findFirst(model, {
                op: 'and',
                clauses: [
                  { op: 'eq', field: runtime.viewModel(model).primaryKey, value: coerceId(route.id!, model) },
                  modelScope
                ]
              })
            : await runtime.adapter.data.getRecord(model, route.id!);
          const relationOptions = await loadRelationOptions(runtime, model, { locals: event.locals }, route.id);
          const relatedCounts = item ? await loadRelatedCounts(runtime, model, route.id!, { locals: event.locals }) : undefined;
          content = item
            ? render(Form, {
                props: {
                  mode: 'edit',
                  model: { ...runtime.viewModel(model), relationOptions, relatedCounts },
                  basePath: runtime.basePath,
                  config: runtime.config,
                  item,
                  recordActions: actionsForModel(registry, model.name).map((action) => ({
                    label: action.label,
                    href: action.href({
                      model: model.name,
                      id: item[runtime.viewModel(model).primaryKey] as string | number,
                      basePath: runtime.basePath
                    })
                  }))
                }
              }).body
            : render(NotFound, {
                props: { message: `${model.name} with ID "${route.id}" not found`, basePath: runtime.basePath }
              }).body;
        }
      }
    } catch (e: any) {
      console.error('[sveltekit-admin] Error:', e);
      content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }

    const html = render(Layout, {
      props: {
        content,
        config: runtime.config,
        modelList: runtime.modelList,
        currentModel,
        extraStyles,
        extraScripts
      }
    }).body;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  };
}
