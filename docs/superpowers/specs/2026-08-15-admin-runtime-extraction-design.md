# Extraction du runtime admin (design)

## Contexte

`sveltekit-admin` expose un admin zéro-routes : `createAdminHandler` intercepte `basePath` et rend du HTML SSR. L’ORM est déjà derrière `SchemaIntrospector` / `DataAdapter` (Prisma et Drizzle). Ce qui reste fermé, et qui bloquera un système de plugins, c’est le cœur :

- `handler.ts` (~1050 lignes) concentre boot, helpers, loaders de relations, `_search`, POST, dispatch GET et wrap `Layout` dans des closures.
- `parseRoute` n’a qu’une union fixe de vues. Trois segments ou plus (`/admin/user/42/graph`) sont `notFound` par construction.
- Layout / Form / List n’ont aucun point d’accroche (pas d’action sur une fiche ou une ligne, pas de JS/CSS additionnel).
- Schéma, graphe, adapter et helpers de sécu (`hidden`, `isSensitiveFieldName`, `listWhere`) ne sont pas un objet qu’un futur plugin puisse recevoir.

But du projet plus large : permettre d’enregistrer des plugins dans le handler (`plugins: [relationGraphPlugin({ models: ['User'] })]`), le premier étant un graphe de dépendances d’un record. Vu l’ampleur, trois specs séquentielles, trois PRs :

1. **Ce document** — extraire un runtime interne, une table de routes et des slots UI, sans changer aucun comportement observable. Pur refactor. Aucune API `plugins`.
2. **Spec suivante** (session 2) — API publique `AdminPlugin` (routes + actions record + JS/CSS inline).
3. **Spec suivante** (session 3) — premier plugin (graphe), uniquement via cette API.

Les décisions de nord pour (2) et (3) sont en annexe : elles justifient *quels* joints extraire ici, elles ne sont pas à implémenter dans cette PR.

Contrainte non négociable : `vitest.config.ts` impose 100 % de couverture (lines/statements/functions/branches) sur `src/lib/**`, sans `exclude` ni `v8 ignore`. Les tests `tests/characterization/*` et les intégrations handler (Prisma SQLite + Drizzle) sont le filet de non-régression.

## Objectif

- Introduire un `AdminRuntime` construit une fois au boot, passé explicitement au hook et aux loaders — plus de closures de 800 lignes dans `createAdminHandler`.
- Remplacer le parseur ad hoc par une table de *patterns* interne. `parseRoute(pathname, basePath)` conserve sa signature et son résultat pour les routes built-in (y compris 3 segments → `notFound`).
- Brancher trois slots UI, vides par défaut : `extraStyles` / `extraScripts` sur `Layout`, `recordActions` sur `Form` (fiche edit) et `List` (lignes). Zéro nœud HTML de plus quand ils sont vides.
- **Zéro breaking change** : `createAdminHandler({ prisma })` (entry `.`) et `createAdminHandler({ adapter })` (core / Drizzle) restent identiques. Aucun nouvel export sur `src/lib/index.ts`. Aucun champ `plugins` sur `AdminHandlerConfig`.

## Approches écartées

1. **Découper `handler.ts` sans ouvrir routeur ni vues** — PR plus petite, mais la PR plugins devrait alors toucher Layout / Form / List / `parseRoute`. Le vrai joint est juste reporté.
2. **Exporter `plugins?: AdminPlugin[]` dès cette PR** — valide le contrat trop tôt, sans consommateur (le graphe) pour le mettre à l’épreuve ; fusionne les PR 1 et 2 ; changeset minor + docs pour une API qu’on s’est engagés à poser ensuite.
3. **Ménage générique hors joints plugins** (renommages `formDataToPrisma`, refonte de `AdminHandlerConfig`, extraction d’un dossier par vue métier) — hors but. On n’extrait que ce que la PR 2 remplira.

**Retenu** : runtime interne + table de routes + slots branchés et vides. Même logique que l’abstraction adapters : d’abord les joints, zéro changement observable, puis l’API, puis le premier consommateur.

## Architecture

```
createAdminHandler(config)
  └─ createAdminRuntime(config)     // une fois, au boot
        │
handle({ event, resolve })
  ├─ hors basePath → resolve(event)
  ├─ matchRoute(..., BUILTIN_ROUTES)
  ├─ logout (POST, avant auth) → authCheck
  └─ dispatch(runtime, event, route)
        ├─ _search → JSON (pas de Layout)
        ├─ POST create/update/delete → adapter + audit → 303
        └─ GET vue → render(View) → render(Layout)
              extraStyles / extraScripts = ''
              recordActions = []
```

`handler.ts` ne fait plus le boot ni les loaders : il orchestre. Les vues n’interrogent pas le runtime ; elles affichent les props qu’on leur passe. En PR 2, le même wrap remplira les slots ; Form / List / Layout ne changent plus de contrat.

## Composants

### `src/lib/server/runtime.ts` *(nouveau)*

`createAdminRuntime(config: AdminHandlerConfig): AdminRuntime`

Reprend tel quel le boot actuel de `handler.ts` : introspect synchrone (un `Promise` throw encore), `buildRelationGraph`, warnings diagnostics, filtre `exclude` / `hidePivotTables`, validation `listFilter` au boot, helpers.

```ts
interface AdminRuntime {
  adapter: { introspector: SchemaIntrospector; data: DataAdapter };
  schema: Schema | null;
  relationGraph: RelationGraph | null;
  models: Model[];
  modelList: Array<{ name: string; label: string }>;
  config: AdminHandlerConfig;
  basePath: string;
  perPage: number;
  selectThreshold: number;
  filterLinkThreshold: number;
  labelFieldCandidates: string[];
  findModel(name?: string): Model | undefined;
  labelOf(model: Model): string;
  hiddenFieldsOf(model: Model): Set<string>;
  viewModel(model: Model): ViewModel;
  resolveLabel(
    target: Model,
    row: Record<string, unknown>,
    labelTemplate?: string
  ): string;
  resolveFilterableFields(model: Model): Set<string>;
}
```

Pas d’`event` sur le runtime (boot ≠ requête). Rien n’est exporté par `src/lib/index.ts` ni par l’entry Drizzle. Les tests unitaires importent le module interne, comme `router.ts` aujourd’hui.

`createAdminHandler` conserve le throw core « `adapter` requis » (message inchangé) **avant** d’appeler `createAdminRuntime`. Le runtime suppose `config.adapter` présent. `perPage` vaut `20` — c’est l’actuelle constante locale `PER_PAGE`, unique, pour que list GET et `_search` ne dupliquent pas le littéral.

Schéma illisible : même dégradation — warning, `schema` / `relationGraph` nuls, `models` vide. Le raccourci `{ prisma }` (wrapper) et ses messages à lui ne bougent pas.

### `src/lib/server/router.ts`

Aujourd’hui `parseRoute` encode les vues en `if` sur le nombre de segments. On introduit :

```ts
interface RouteEntry {
  pattern: string[];
  view: string;
}

export const BUILTIN_ROUTES: RouteEntry[] = [
  { pattern: [], view: 'dashboard' },
  { pattern: ['_search'], view: 'search' },
  { pattern: ['_logout'], view: 'logout' },
  { pattern: [':model', 'new'], view: 'create' },
  { pattern: [':model', ':id'], view: 'edit' },
  { pattern: [':model'], view: 'list' }
];

function matchRoute(
  pathname: string,
  basePath: string,
  routes: RouteEntry[]
): { view: string; model?: string; id?: string };

function parseRoute(pathname: string, basePath: string): ParsedRoute;
```

Règles du matcher (identiques au parseur actuel pour `BUILTIN_ROUTES`) :

- Le path relatif à `basePath` est normalisé comme aujourd’hui (`replace` des `/` de tête/queue, pour que `/admin/` et `/admin///` soient le dashboard).
- Premier `RouteEntry` dont `pattern.length === segments.length` et chaque token matche : littéral = égalité, `:model` / `:id` = capture sur `model` / `id`.
- `':model', 'new'` est **avant** `':model', ':id'` dans `BUILTIN_ROUTES` : `/user/new` reste `create`, jamais `edit` avec `id: 'new'`.
- Aucune entrée ne matche → `{ view: 'notFound' }`. Pas de catch-all.
- `parseRoute` = `matchRoute(..., BUILTIN_ROUTES)` calé sur `ParsedRoute`. L’union `view` publique des tests **ne s’élargit pas**. Trois segments sur la table built-in restent `notFound`.

Les captures autres que `:model` / `:id` sont ignorées dans cette PR (le graphe n’a besoin que de ces deux-là plus un littéral `graph`, qui ne capture rien). `ParsedRoute` ne gagne pas de champ `params`.

`matchRoute` / `BUILTIN_ROUTES` sont exportés du module `router.ts` pour les tests, **pas** du package.

### `src/lib/server/relationLoaders.ts` *(nouveau)*

`loadRelationOptions`, `resolveFkFilterOptions`, `loadRelatedCounts` — mêmes signatures effectives, `runtime` en premier argument à la place des closures. Comportement (parallélisme, try/catch → raw-id / count 0, chip FK hors scope = pas de label) inchangé.

### `src/lib/server/search.ts` *(nouveau)*

`handleSearch(runtime, event)` — l’endpoint `GET {basePath}/_search`. Même JSON, mêmes 404/500, `containsExact` pour rester case-sensitive.

### `src/lib/server/mutations.ts` *(nouveau)*

POST create / update / delete : `formDataToPrisma`, revalidation FK/m2m, `adapter.data.*`, `audit` après succès, 303. Aucun nouveau type d’action. Une action `_action` inconnue continue de tomber dans le rendu GET.

### `src/lib/server/handler.ts`

Factory mince : `createAdminRuntime`, retourne le hook. Le hook : garde `basePath`, `parseRoute` (donc built-in only), logout, `authCheck`, dispatch vers search / mutations / rendus GET, wrap `Layout`.

C’est **lui**, pas les vues, qui passe :

- `extraStyles: ''`, `extraScripts: ''`
- `recordActions: []` (Form et List)
- `config: runtime.config`, `modelList: runtime.modelList`

`AdminHandlerConfig` reste déclaré ici (les vues et le wrapper Prisma l’importent déjà). Pas de champ `plugins`.

On ne crée pas un dossier `core/` ni un fichier par vue métier (Dashboard / List / Form restent rendues depuis le handler).

### Slots UI

Types dans `src/lib/server/views/types.ts` :

```ts
interface RecordAction {
  label: string;
  href: string;
}

interface ListRecordAction {
  label: string;
  hrefFor: (id: string | number) => string;
}
```

| Vue | Prop | Défaut | Rendu si non vide |
|---|---|---|---|
| `Layout.svelte` | `extraStyles: string` | `''` | `{#if extraStyles}` → `<style>` dans `<head>` |
| `Layout.svelte` | `extraScripts: string` | `''` | `{#if extraScripts}` → `<script>` en fin de `<body>` |
| `Form.svelte` | `recordActions: RecordAction[]` | `[]` | barre de liens **seulement** si `mode === 'edit'` et `length > 0`, entre le sous-titre ID et la card du formulaire — pas dans le `<form>` POST |
| `List.svelte` | `recordActions: ListRecordAction[]` | `[]` | un `<a>` par action dans la cellule `ska-table__actions` **déjà existante**, avant Edit. Pas de colonne de plus. `colspan` de la row vide inchangé (`displayFields.length + 1`) |

Pas de slot nav. Pas d’endpoint JSON. Pas de type `AdminPlugin`.

`label` passe par le texte Svelte (échappé). `href` / `hrefFor` sont des URLs construites par l’appelant, pas interpolées depuis un champ DB brut. `extraStyles` / `extraScripts` sont de la confiance développeur, comme `branding.primaryColor` : pas d’escaping (ce sera du code de plugin, pas de la data request). Chaîne vide = **aucun** `<style>` / `<script>` plugin (pas de balise vide).

Create : le handler passe `[]` ; Form ignore `recordActions` hors `mode === 'edit'` même si un test lui en passe.

## Flux de données

Une requête `/admin/...` :

1. Hors `basePath` → `resolve(event)`.
2. `parseRoute` → vue built-in ou `notFound`.
3. `logout` POST-only **avant** `authCheck` (405 si GET, 303 vers `logoutRedirectTo`).
4. `authCheck` false → 401.
5. `search` → JSON, pas de Layout.
6. POST create/update/delete → `mutations.ts` (validation FK/m2m, adapter, audit opt-in, 303).
7. GET → loaders avec `{ runtime, event, route }` → `render(View)` → `render(Layout)`.

Les données d’un futur graphe (PR 3) seront lues via `runtime.adapter` + `runtime.relationGraph`, redactées avec `hiddenFieldsOf` / `isSensitiveFieldName`, et embarquées dans le HTML. Le JS inline ne fera que visualiser. **Pas dans cette PR.**

## Erreurs et invariants

Comportement public identique. On déplace, on ne change pas les échecs.

- Schéma illisible au boot : warning + admin vide, pas un throw hors de `createAdminHandler`.
- `listFilter` invalide : throw au boot.
- Scope `listWhere` / `relations[].where` qui renvoie `{}` : throw (`normalizeScope`), jamais fail-open.
- Logout GET : 405. `authCheck` false : 401. Modèle inconnu : 404 HTML dans le Layout.
- Loaders / `_search` : mêmes replis (raw-id, count 0, JSON 404/500).
- `audit` qui throw : mutation déjà committée, `console.error` préfixé, 303.

Invariants de sécu à ne pas relâcher (les tests existants doivent toujours les pincer) :

- `hidden` + `isSensitiveFieldName` fermés sur liste, `?q=`, `?f.*=`, audit.
- `listWhere` compose en `AND`, jamais un spread.
- Revalidation FK/m2m au POST, même scope que le `<select>`.
- Chip FK hors scope = id brut, jamais le label.
- `_search` case-sensitive (`containsExact`).

Pas de nouveau type d’erreur « plugin failed », pas de sandbox, pas de timeout.

## Tests

Critère d’acceptation : **zéro changement observable**. Characterization, `handler.db.test.ts`, `handler.m2m.db.test.ts`, `handler.drizzle.db.test.ts`, et les unitaires handler / auth / audit / logout / security / search / fk / m2m restent verts **sans** modifier leurs assertions HTML/DB. Les tests Prisma continuent d’importer le wrapper `adapters/prisma/handler.ts` ; Drizzle, l’entry `adapters/drizzle`.

Ajouts :

- **`tests/unit/router.test.ts`** : cas `parseRoute` inchangés, y compris 3 segments → `notFound`. Nouveau describe `matchRoute` : table = `[...BUILTIN_ROUTES, { pattern: [':model', ':id', 'graph'], view: 'graph' }]` → `/admin/user/1/graph` donne `{ view: 'graph', model: 'user', id: '1' }` ; sans cette entrée, `parseRoute` sur le même path reste `notFound`.
- **`tests/unit/views/layout.test.ts`** : défauts vides = pas de `<script>` / `<style>` plugin (le `<style>` du thème existant, lui, reste). `extraStyles: '.x{}'` apparaît dans `<head>` ; `extraScripts: 'window.__x=1'` en fin de `<body>`.
- **`tests/unit/views/form.test.ts`** : `[]` ou omit = pas de barre d’actions. En `edit`, `[{ label: '<img>', href: '/admin/user/1/graph' }]` rend un lien dont le href est celui-ci et dont le label est échappé (pas de balise `<img>`). En `create`, la même prop non vide **ne rend rien**.
- **`tests/unit/views/list.test.ts`** : `[]` = cellule Actions = Edit + Delete seulement. Une action avec `hrefFor: (id) => \`/admin/user/${id}/graph\`` est appelée avec la PK de la row et rend le lien avant Edit. `colspan` inchangé.
- **`tests/unit/runtime.test.ts`** : boot (`exclude`, `hidePivotTables`, throw `listFilter`, schéma cassé → `models` vide), `labelOf` / `findModel` insensible à la casse comme aujourd’hui.

Pas de test e2e plugin : il n’y a pas de plugin. Coverage 100 %, sans `v8 ignore` : les branches « slot non vide » sont couvertes par les rendus directs ci-dessus, pas par le handler (qui passe toujours vide).

## Docs / changeset

- Changeset **patch** : refactor interne, aucun contrat consommateur nouveau ou cassé.
- `CLAUDE.md` : le flux de requête mentionne `AdminRuntime` + table `BUILTIN_ROUTES` + loaders extraits, au lieu de « lire `handler.ts` de haut en bas comme un seul bloc ». Les invariants sécu restent.
- Pas de page `docs/src/lib/content/**` : rien à documenter pour un consommateur.
- README, `example/`, surface d’exports (`tests/unit/index.test.ts`) : inchangés.

## Hors périmètre (cette PR)

- Champ `plugins` / type `AdminPlugin` / export public.
- Entrée de nav plugin, remplacement de vues, interception CRUD.
- Endpoints JSON plugin, route qui sert un fichier `.js`, pipeline Vite pour le JS plugin.
- Le plugin graphe, une lib de visualisation, des données embarquées dans le HTML.
- Export `./core` ou `./runtime`.
- `import()` dynamique, `createAdminHandler` async, introspection async.
- Sandbox / CSP / timeout des scripts inline.
- Refactors opportunistes hors des fichiers listés (`formDataToPrisma`, types `Prisma*` publics, etc.).

---

## Annexe — nord plugins (PR 2 / PR 3, pas cette PR)

Décisions déjà prises, pour ne pas extraire les mauvais joints. **Ne pas implémenter ici.**

| Sujet | Décision v1 |
|---|---|
| Surface plugin | Pages + actions record. Pas d’interception CRUD, pas de remplacement list/form/dashboard. |
| Rendu d’une page plugin | SSR dans le `Layout` existant + JS/CSS **inline**. Pas d’endpoints JSON. Données du graphe embarquées dans le HTML au render. |
| Actions | Fiche **edit** et **ligne de liste**. Pas d’entrée de nav sidebar. |
| Enregistrement | Tableau global : `createAdminHandler({ plugins: [relationGraphPlugin({ models: ['User'] })] })`. L’auteur customisé via **sa** factory ; le core ne connaît pas `depth` / `models`. |
| Livraison JS | Chaînes inline. Pas de GET `/admin/_plugin/*.js`. |
| Data / sécu | Tout accès passe par `AdminRuntime` (adapter, graphe, `hiddenFieldsOf`, `isSensitiveFieldName`, scopes). Un plugin ne parle pas à Prisma/Drizzle directement. |
| Découpage | PR 2 = API publique. PR 3 = premier plugin (graphe de dépendances d’un record), uniquement via cette API. |

Non décidé (session 2+) : packaging first-party (`sveltekit-admin/plugins/...`) vs package npm séparé ; ordre / collisions si deux plugins ciblent le même modèle ; lib de visualisation du graphe.
