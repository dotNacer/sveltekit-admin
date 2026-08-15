# API publique plugins (`AdminPlugin`) (design)

## Contexte

PR 1 (`07a390e`) a extrait les joints, **vides** : `AdminRuntime` interne, `matchRoute` + `BUILTIN_ROUTES`, slots Layout (`extraStyles` / `extraScripts`) et Form/List (`recordActions`). `parseRoute` reste builtins-only : `/admin/user/1/graph` est `notFound`. `src/lib/index.ts` n’exporte ni runtime ni `plugins`. Les slots sont toujours passés `''` / `[]` depuis le handler.

Nord du projet (pas cette PR) :

```ts
createAdminHandler({
  prisma,
  plugins: [relationGraphPlugin({ models: ['User'] })]
})
```

Clic sur un record → graphe de dépendances. `models` / `depth` sont des options de **la factory auteur**. Le core ne les connaît pas.

Cette spec = **PR 2 uniquement** : contrat public `plugins: []`, câblage runtime / routeur / slots, validation par un **plugin factice** dans les tests. Le plugin graphe est la PR 3.

`vitest.config.ts` impose 100 % de couverture sur `src/lib/**`, sans `exclude` ni `v8 ignore`.

## Objectif

- Champ `plugins?: AdminPlugin[]` sur `AdminHandlerConfig` (core **et** wrapper Prisma). Omis = comportement actuel.
- Types publics `AdminPlugin` + ctx / résultat de page, exportés par `.` et par `sveltekit-admin/adapters/drizzle`. **Pas** d’export `createAdminRuntime`.
- Pages plugin SSR dans le Layout existant + CSS/JS inline **par requête**. Actions record sur fiche edit et lignes de liste.
- Lectures plugin **imposées par le core** : `listWhere` + redaction `hidden` / `isSensitiveFieldName`. Pas d’`adapter` sur le ctx public.
- Overlay d’une route builtin → throw au boot. Collision de patterns plugin → throw. Actions → concat.

Changeset **minor**.

## Décisions verrouillées

| Sujet | Décision v1 |
|---|---|
| Surface | Pages nouvelles + actions record. Pas d’interception CRUD, pas de remplacement list/form/dashboard, pas de nav sidebar. |
| Rendu page | `render(ctx) → { html, styles?, scripts? }` (sync ou `Promise`). Layout existant. Pas d’endpoint JSON. Pas de composant Svelte consommateur. |
| Assets | `styles` / `scripts` fusionnés dans les slots Layout **uniquement** sur cette requête. Liste / edit / dashboard : `extraStyles` / `extraScripts` restent `''`. |
| Actions | Fiche edit + ligne de liste, liens avant Edit. Create ignore. |
| Enregistrement | `plugins: [factory({ ... })]`. Le core reçoit des `AdminPlugin`, pas les options graphe. |
| Ciblage modèles | `models?: string[]` optionnel sur **pages** et **actions** (générique). Omit = tous les modèles visibles. Mismatch page → 404. |
| Collisions routes | Pattern identique (builtin ou autre page, y compris même plugin) → throw au boot. Overlap non identique → premier match (**plugins d’abord, dans l’ordre de `plugins`, puis builtins**) : un token littéral en position `:model`/`:id` peut donc masquer silencieusement `:model`/`:model/:id`/`:model/new` pour cette valeur (ex. `['user']` prend le pas sur la liste User). |
| Collisions actions | Concat : ordre du tableau `plugins`, puis ordre interne du plugin. Libellés dupliqués autorisés. |
| Data / sécu | Helpers de lecture scopés + redaction. Pas d’`adapter` / writes sur le ctx. |
| Auth | Pages plugin **après** `authCheck`. Logout POST avant auth, inchangé. |
| JS | Chaînes inline. Pas de GET `/admin/_plugin/*.js`, pas de pipeline Vite. |
| Packaging first-party | PR 3 (`sveltekit-admin/plugins/...` vs npm séparé). |

## Approches écartées

1. **Plugins accrochés à `AdminRuntime`** — un seul objet partout, mais le runtime cesse d’être « boot schéma » ; les tests runtime se mélangent aux throw plugin.
2. **`register(api)` style Django** — trop pour `plugins: []` v1 ; collisions plus floues.
3. **`render` → `string` + assets globaux** — le JS graphe se chargerait sur dashboard / liste.
4. **Helpers minimaux (`record` + `escapeHtml` seulement)** — la PR 3 devrait élargir l’API publique.
5. **`runtime.adapter` laissé sur le ctx** — un plugin sloppy redevient un oracle `getRecord`.
6. **Scoper l’edit/delete dans cette PR** — hors périmètre ; l’incohérence « edit ouvert / page plugin 404 » est **voulue** et documentée.

**Retenu** : module registre + module d’accès + dispatch dans le handler. `createAdminRuntime` inchangé de rôle.

## Architecture

```
createAdminHandler(config)
  ├─ createAdminRuntime(config)          // schéma / graphe, pas de plugins
  └─ resolvePluginRegistry(plugins ?? [], BUILTIN_ROUTES, runtime.models)

handle({ event, resolve })
  ├─ hors basePath → resolve(event)
  ├─ matchRoute(..., [...registry.routes, ...BUILTIN_ROUTES])  // plugins d'abord : overlay identique throw au boot, un token littéral peut masquer :model/:id
  ├─ logout POST (avant auth)
  ├─ authCheck → 401
  ├─ _search
  ├─ vue plugin + method !== GET → 405
  ├─ POST + vue builtin list/create/edit → handleMutation
  └─ GET
        ├─ vue plugin
        │    findModel + whitelist models → sinon NotFound (sans fetch)
        │    :id → loadRecord (listWhere AND PK, redaction) ou NotFound
        │    render(ctx) → Layout(html, styles, scripts)
        └─ vues builtin (slots actions remplis sur list/edit)
```

`parseRoute` **ne change pas** (builtins only, y compris 3 segments → `notFound`). Le handler n’utilise plus `parseRoute` pour le dispatch : il passe par `matchRoute` sur la table concaténée. Les tests `parseRoute` existants restent valides.

`matchRoute` ne capture toujours que `:model` et `:id`. Une route graphe typique est `[':model', ':id', 'graph']` (3ᵉ token littéral). Pas de `startsWith(':')` générique.

## Composants

### `src/lib/server/plugin.ts` *(nouveau — types publics)*

```ts
export interface AdminPlugin {
  name: string;
  pages?: AdminPluginPage[];
  recordActions?: AdminPluginRecordAction[];
}

export interface AdminPluginPage {
  pattern: string[];
  models?: string[];
  render: (ctx: PluginPageContext) => PluginPageResult | Promise<PluginPageResult>;
}

export interface PluginPageResult {
  html: string;
  styles?: string;
  scripts?: string;
}

export interface AdminPluginRecordAction {
  label: string;
  models?: string[];
  href: (ctx: { model: string; id: string | number; basePath: string }) => string;
}

export interface PluginPageContext {
  event: any;
  route: { view: string; model?: string; id?: string };
  basePath: string;
  /** Uniquement si le pattern capture `:id` (et après le 404 hors scope). */
  record?: Record<string, unknown>;
  escapeHtml: (s: string) => string;
  findModel: (name?: string) => Model | undefined;
  relationGraph: RelationGraph | null;
  resolveLabel: (
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ) => string;
  hiddenFieldsOf: (model: Model) => Set<string>;
  isSensitiveFieldName: (name: string) => boolean;
  loadRecord: (
    modelName: string,
    id: string | number
  ) => Promise<Record<string, unknown> | null>;
  listRecords: (
    modelName: string,
    extraFilter?: Filter
  ) => Promise<Record<string, unknown>[]>;
  getM2mSelectedIds: (
    modelName: string,
    fieldName: string,
    recordId: string | number
  ) => Promise<Array<string | number>>;
}
```

`isSensitiveFieldName` sur le ctx est **la** fonction de `introspection/parser.ts` (référence, pas une copie). Un plugin qui itère `model.fields` doit s’en servir ; les payloads `record` / `loadRecord` / `listRecords` sont déjà redactés.

Le plugin ne choisit pas `view`. Le registre pose `view: \`plugin/${name}/${pattern.join('/')}\`` — ex. `plugin/fake-graph/:model/:id/graph`. Dispatch par `pagesByView.has(route.view)`, pas par `startsWith`.

Le core mappe `href` vers `RecordAction.href` (edit, id déjà connu) et `ListRecordAction.hrefFor` (liste). Create : `recordActions: []` inchangé.

`AdminPluginPage.models` n’a de sens que si le pattern contient `:model` — sinon throw au boot. Une page **sans** `:model` est globale (ex. `['hello']`) : pas de `findModel`, pas de whitelist, pas de preload. Une page **sans** `:id` : `record` absent, `loadRecord` non appelé par le core.

### `src/lib/server/pluginRegistry.ts` *(nouveau)*

`resolvePluginRegistry(plugins, builtinRoutes, visibleModels): PluginRegistry`

`PluginRegistry` :

- `routes: RouteEntry[]` — pages plugin, **dans l’ordre** du tableau `plugins` puis de `pages`
- `pagesByView: Map<string, AdminPluginPage>`
- `recordActions: AdminPluginRecordAction[]` — concat, même ordre

Validation au boot (throw, préfixe `[sveltekit-admin]`) :

| Condition | Motif |
|---|---|
| `name` vide | identité obligatoire pour les messages et les `view` |
| `name` dupliqué (égalité de chaîne) | `view` collision |
| pattern identique à une entrée `BUILTIN_ROUTES` | pas d’overlay silencieux (`[]`, `_search`, `_logout`, `:model`, `:model/new`, `:model/:id`) |
| pattern identique à une autre page plugin (même plugin ou un autre) | collision |
| token `:` autre que `:model` / `:id` | pas de param générique (piège couverture) |
| `models[]` dont aucun modèle visible ne matche (casse comme `findModel`) | erreur de développeur, comme `listFilter` invalide |
| `page.models` défini mais pattern sans `:model` | config incohérente |
| pattern avec `:id` mais sans `:model` | le preload ne saurait pas quel modèle lire |

Plugin sans `pages` ni `recordActions` : autorisé (no-op). Pas de throw.

### `src/lib/server/pluginAccess.ts` *(nouveau)*

`createPluginPageContext(runtime, event, route): PluginPageContext`

Helpers de lecture — **jamais** `adapter.data.getRecord` (unscoped) :

**`loadRecord(modelName, id)`**

1. `findModel` → miss → `null` (pas de throw : une arête graphe vers un modèle exclu ne doit pas exploser).
2. Lire `listWhere` via le même helper que la liste (voir ci-dessous). `{}` → **le même throw** que la liste.
3. `findFirst` avec AND `{ op: 'eq', field: pk, value: coerceId(String(id), model) }` + scope. Jamais un fetch puis un filtre en mémoire.
4. Miss → `null`. Hit → `redactForAudit(row, model, hiddenFieldsOf(model))`.

`loadRecord` / `listRecords` appliquent **uniquement** `models[M].listWhere` du modèle lu, pas `relations[field].where` (celui-ci reste le scope des dropdowns FK/m2m du form).

**`listRecords(modelName, extraFilter?)`**

1. `findModel` miss → `[]`.
2. Même `listWhere` / throw `{}`.
3. `findMany` avec AND scope + `extraFilter` (si présent). **Jamais un spread d’objets.** Pas de `skip`/`take` : pas de cap v1 (la factory graphe bornes via `depth`).
4. Chaque row passée à `redactForAudit`.

**`getM2mSelectedIds(modelName, fieldName, recordId)`**

1. `findModel` miss → throw (appel développeur, pas un walk opportuniste). Graphe non-null par construction dès qu’un modèle est visible (`relationGraph!`, comme le GET create).
2. Arête `Model.field` absente ou `kind !== 'm2m'` → throw.
3. Délègue à `adapter.data.getM2mSelectedIds`. Les ids cibles **ne sont pas** pré-filtrés par le `listWhere` de la cible : hors scope = `loadRecord` → `null`.

Pas d’écriture (`create` / `update` / `delete`) sur le ctx. Pas de `config`, pas d’`adapter`.

### `listScopeFrom` *(déplacement ciblé dans `runtime.ts`)*

Aujourd’hui le throw `listWhere` `{}` est inline dans le GET liste du handler. Les helpers plugin doivent **le même** message et la même sémantique (`{}` fail-loud, `undefined`/omis = pas de scope). Extraire `listScopeFrom(runtime, model, ctx)` à côté de `scopeFrom` : il fait le throw `{}` et renvoie `undefined` ou la **valeur brute** de `listWhere` (comme aujourd’hui). Le GET liste continue de passer ce brut à `buildWhere`. `pluginAccess` le passe à `normalizeScope` avant de composer l’AND Filter. Ce n’est pas un refactor opportuniste : c’est le joint sécu partagé. Texte d’erreur **inchangé**.

Sans `listWhere` configuré, les pages plugin restent ouvertes — comme la liste. La spec / les docs le disent : ce n’est pas « tenant-safe by default ».

### `src/lib/server/handler.ts`

Après `createAdminRuntime` : `const registry = resolvePluginRegistry(config.plugins ?? [], BUILTIN_ROUTES, runtime.models)`.

Dispatch : `matchRoute(pathname, runtime.basePath, [...registry.routes, ...BUILTIN_ROUTES])` (plugins d’abord ; overlay identique throw au boot).

- Vue plugin, `method !== 'GET'` → `405` + `Allow: GET` (y compris POST : pas de delete via `/…/graph`). `handleMutation` reste réservé aux vues builtin list/create/edit.
- Vue plugin GET :
  - pattern avec `:model` : `findModel` miss ou hors `page.models` → NotFound **sans fetch**.
  - pattern avec `:id` : `loadRecord` → miss → NotFound, `render` non appelé.
  - sinon `render`, puis Layout avec `content = html`, `extraStyles` / `extraScripts` issus du résultat (`undefined` / `''` = pas de balise extra). NotFound plugin : Layout **sans** assets du plugin.
  - `currentModel = route.model` (sidebar) ; absent si le pattern n’a pas `:model`.
- `render` qui throw → le `try/catch` existant (alerte HTML `escapeHtml`), pas de type d’erreur plugin.
- List / edit builtin : `recordActions` = actions du registre dont `models` est omis ou contient ce modèle (casse `findModel`). Ordre = concat. Labels / hrefs toujours `escapeHtml` dans Form/List (déjà en place).
- Dashboard / create / notFound builtin : slots plugin vides comme aujourd’hui.

Svelte 5 : `extraStyles` reste **concaténé** dans le `{@html}` du thème (byte-identique si `''`). Ne pas réintroduire un `{#if}` frère.

### Config / exports

`AdminHandlerConfig` (core, `handler.ts`) :

```ts
plugins?: AdminPlugin[];
```

Le wrapper Prisma (`adapters/prisma/handler.ts`) étend déjà le core via `Omit<…>` : `plugins` est hérité. `omitPrismaShortcutFields` le laisse dans `rest`. Les deux chemins `{ prisma }` et `{ adapter }` acceptent `plugins`.

Entry `.` (`src/lib/index.ts`) et `sveltekit-admin/adapters/drizzle` exportent les types `AdminPlugin`, `AdminPluginPage`, `AdminPluginRecordAction`, `PluginPageContext`, `PluginPageResult`. Re-export depuis le wrapper Prisma (même liste).

`tests/unit/index.test.ts` : `RUNTIME_EXPORTS` inchangé (cinq fonctions). Ajouter les cinq types à `TYPE_ONLY_EXPORTS`.

**Ne pas** exporter `createAdminRuntime`, `AdminRuntime`, `matchRoute`, `resolvePluginRegistry`.

## Flux de données

GET `/admin/user/1/graph` avec un plugin `name: 'fake-graph'`, pattern `[':model', ':id', 'graph']`, `models: ['User']` :

1. Hors `basePath` → `resolve`.
2. `matchRoute` : la page plugin d'abord (elle capte `[':model', ':id', 'graph']`, longueur 3 — aucun builtin n'a cette forme, donc pas de compétition ici) → `{ view: 'plugin/fake-graph/:model/:id/graph', model: 'user', id: '1' }`. Un pattern littéral en position `:model`/`:id` aurait, lui, pu masquer une vue builtin puisque les routes plugin sont testées avant `BUILTIN_ROUTES`.
3. Pas logout / pas `_search`. `authCheck` si configuré.
4. GET → `findModel('user')` = User, whitelist OK.
5. `loadRecord('User', '1')` : `listWhere` AND pk. Hors scope / absent → NotFound, **`render` n’est pas appelé**.
6. `ctx.record` = row redactée. `render` → HTML + CSS/JS inline.
7. Layout : `content` = HTML plugin, `extraStyles` / `extraScripts` = assets de **cette** page, `currentModel` = `user`.

Les données d’un futur graphe (PR 3) seront lues uniquement via `loadRecord` / `listRecords` / `getM2mSelectedIds` + `relationGraph`, embarquées dans `html` ou `scripts` au render. Le JS inline ne fait que visualiser.

## Erreurs et invariants

- Overlay builtin / collision de patterns / `models[]` inconnu / `:foo` / `name` vide ou dupliqué : throw **au boot**, pas à la première requête.
- Page plugin hors whitelist ou record hors `listWhere` : 404 Layout, pas de leak de label.
- Page plugin **plus stricte que l’edit** : `/admin/user/1` peut afficher le formulaire (`getRecord` unscoped) alors que `/admin/user/1/graph` 404. Documenté. On ne scope pas l’edit dans cette PR.
- `hidden` + `isSensitiveFieldName` absents des payloads helper (via `redactForAudit`, même chemin que l’audit). Un plugin qui `JSON.stringify(record)` ne peut pas les renvoyer. Fermer aussi le HTML du plugin factice dans les tests.
- `listWhere` / `where` `{}` : throw, jamais fail-open.
- AND scope + filtre : tableau de clauses, jamais un spread.
- XSS : `label` / `href` d’actions échappés par Form/List. HTML/CSS/JS de `render` = confiance développeur (comme `branding.primaryColor`). Champs DB interpolés dans `html` → `ctx.escapeHtml`.
- Auth : 401 brut (comme le reste), pas de Layout plugin.
- Pas de sandbox / CSP / timeout.

Invariants existants (liste, `?q=`, `?f.*=`, audit, revalidation FK/m2m, chip FK hors scope, `_search` case-sensitive) : inchangés. Characterization sans plugin : **zéro** `<script>` extra, **zéro** `ska-record-actions`, **zéro** `/graph` servi.

## Tests

Plugin factice **uniquement dans les tests** (`tests/fixtures/fakeGraphPlugin.ts`, pas un export du package) :

- `name: 'fake-graph'`
- page `[':model', ':id', 'graph']`, `models: ['User']`
- `render` : HTML bête (titre + `JSON.stringify(record)`), `styles` / `scripts` inline distinctifs (ex. `.ska-fake-graph{}` / `window.__skaFakeGraph=1`)
- `recordActions` : label `Graph`, même whitelist User, `href` → `${basePath}/${model.toLowerCase()}/${id}/graph`

Pas de D3, pas de vrai graphe, pas de lecture hors helpers.

| Cas | Attendu |
|---|---|
| `plugins` omis ou `[]` | characterization / handler existants : pas de `<script>` extra, pas de `ska-record-actions`, GET `/admin/user/1/graph` → NotFound |
| GET `/admin/user/1/graph` | Layout + HTML factice ; `<style>` contient le CSS ; `<script>` le JS ; absents des pages list/edit/dashboard |
| Liste User | lien Graph **avant** Edit, href `/admin/user/<pk>/graph` |
| Edit User | barre `ska-record-actions`, même href, hors du `<form>` POST |
| Create User | pas d’action plugin |
| Liste/edit Post | pas de lien Graph |
| GET `/admin/post/1/graph` | 404, `render` non appelé |
| Deux plugins, même pattern | throw au boot (message avec les deux `name`) |
| Overlay `:model` / `:model/:id` / `:model/new` / `_search` / `_logout` / `[]` | throw au boot |
| Pattern `[':model', ':id', ':foo']` | throw au boot |
| `models: ['Nope']` | throw au boot |
| `name` vide ou dupliqué | throw au boot |
| `listWhere` exclut l’id | 404 ; spy/mock : `render` 0 appel |
| `hidden: ['bio']` + champ `password` | absents du HTML même si le plugin dump `record` |
| XSS label `<img>` / href avec quotes | échappés dans list et edit |
| POST `/admin/user/1/graph` | 405, `Allow: GET` ; la row n’est pas supprimée |
| `authCheck` → false | 401 sur la page plugin |
| `{ prisma }` (wrapper) et `{ adapter }` (core) | acceptent `plugins` et servent la page |
| Page `['hello']` sans `:id` | GET `/admin/hello` → 200, pas de `record`, pas de `loadRecord` |
| Page `['hello']` + `models: ['User']` | throw au boot (`:model` manquant) |
| Overlap `['user', ':id', 'graph']` puis `[':model', ':id', 'graph']` | `/admin/user/1/graph` sert le **premier** ; pas de throw |

Fichiers :

- `tests/unit/pluginRegistry.test.ts` — boot
- `tests/unit/pluginAccess.test.ts` — `loadRecord` / `listRecords` / m2m / redaction / `{}`
- `tests/unit/handler.plugins.test.ts` — câblage HTTP + factice (core)
- un cas wrapper Prisma (même fichier ou `handler.test.ts` existant)
- `tests/unit/index.test.ts` — `TYPE_ONLY_EXPORTS`

`render(Layout/Form)` en direct : `config as any` (`AdminHandlerConfig` exige `adapter`). `pnpm run check` est bloquant.

Les tests d’intégration Prisma/Drizzle **sans** plugin restent le filet de non-régression HTML/DB. Pas d’e2e graphe.

## Docs / changeset

- Nouvelle page `docs/src/lib/content/docs/plugins.svx` + entrée nav (section Configuration, après Audit log) : enregistrer `plugins: []`, forme de `AdminPlugin`, exemple factice minimal, sécu (`listWhere` appliqué aux pages plugin, redaction, plus strict que l’edit, pas d’adapter).
- `docs/src/lib/content/docs/configuration-reference.svx` : ligne `plugins` dans le tableau + mention dans l’exemple.
- README : une puce Features + un court paragraphe « Plugins » qui pointe vers les docs.
- `CLAUDE.md` : le flux de requête mentionne `matchRoute` concaténé, le registre, le dispatch plugin après auth ; invariants sécu + les trois nouveaux (ctx sans adapter, 404 hors `listWhere`, redaction payloads plugin).
- `how-it-works.svx` : une phrase — des pages plugin peuvent ajouter des segments au-delà de list/create/edit ; lien vers Plugins.
- Changeset **minor** (`writing-changesets`) : nouveau champ config + nouveaux exports de types. Pas patch.

Pas de `sveltekit-admin/plugins/...`. Pas de factory graphe.

## Hors périmètre

- Plugin graphe, D3/vis, données graphe réelles, packaging first-party
- Endpoints JSON, fichiers `.js` servis, CSP / sandbox / timeout
- Remplacer Dashboard / List / Form, intercept create/update/delete
- Nav sidebar plugin
- `createAdminHandler` async, `import()` dynamique, introspection async
- Export `./runtime` / `./core` / `createAdminRuntime`
- Scoper `getRecord` / edit / delete / dashboard counts
- Refactors hors câblage plugins (`formDataToPrisma`, types `Prisma*` publics, etc.)
