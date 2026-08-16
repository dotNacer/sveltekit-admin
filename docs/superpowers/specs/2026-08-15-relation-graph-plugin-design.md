# Plugin graphe de dépendances (`relationGraphPlugin`) (design)

## Contexte

PR 1 a extrait les joints vides. PR 2 (`b7e5630`, #21) a shippé le contrat public `plugins?: AdminPlugin[]` : pages SSR dans le Layout, `recordActions`, helpers de lecture scopés, pas d’`adapter` sur le ctx. Le plugin factice `tests/fixtures/fakeGraphPlugin.ts` reste un test **d’API** — ce n’est pas le graphe.

Cette spec = **PR 3 uniquement** : le premier plugin first-party, un graphe de dépendances d’un record, **uniquement** via `AdminPlugin`. Le core ne gagne aucune connaissance de `depth` / `models` du graphe. On n’élargit pas `AdminPlugin` (pas de nav sidebar, pas de POST/JSON plugin, pas d’interception CRUD, pas de remplacement list/form/dashboard).

Nord :

```ts
import { createAdminHandler } from 'sveltekit-admin';
import { relationGraphPlugin } from 'sveltekit-admin/plugins/relation-graph';

createAdminHandler({
  prisma,
  plugins: [relationGraphPlugin({ models: ['User'] })]
});
```

Clic Graph sur une ligne / fiche → `/admin/user/1/graph` dans le Layout existant.

Piège : `redactForAudit` est une **whitelist de scalaires**. `ctx.record` / `loadRecord` / `listRecords` n’embarquent **pas** les objets relation ni les list fields. Le walk utilise `ctx.relationGraph` (arêtes) + `loadRecord` / `listRecords` / `getM2mSelectedIds` (nœuds). Les scalaires FK (`authorId`, etc.) survivent à la redaction sauf s’ils sont `hidden` / sensitive.

`vitest.config.ts` impose 100 % de couverture sur `src/lib/**`, sans `exclude` ni `v8 ignore`.

## Objectif

- Factory `relationGraphPlugin({ models?, depth? })` → `AdminPlugin`.
- Subpath `sveltekit-admin/plugins/relation-graph`. Pas d’export depuis `.`.
- Page `[':model', ':id', 'graph']` + `recordAction` label `Graph`.
- Walk borné par `depth`, viz SVG SSR + pan/zoom inline, zéro dépendance.
- Changeset **minor**.

## Décisions verrouillées

| Sujet | Décision v1 |
|---|---|
| Packaging | Subpath `sveltekit-admin/plugins/relation-graph`, même schéma que Drizzle. Tiers = leur propre package + `import type { AdminPlugin } from 'sveltekit-admin'`. |
| Viz | SVG + JS vanilla. Pas de Svelte Flow, D3, ni autre lib. Pas de pipeline Vite. |
| Rendu | Walk + layout en TypeScript. SVG émis dans `html` au render. JS = pan/zoom seulement. Graphe visible sans JS. |
| `models` factory | Whitelist **page + bouton Graph** (contrat plugin). Omis = tous les modèles visibles. Le walk visite tout modèle **visible** (`findModel`). |
| `depth` factory | Défaut `2`. Entier dans `0..8` sinon throw dans la factory. `0` = racine seule. |
| Arêtes marchées | `to-one-owning`, inverses (`to-one-inverse` / `to-many-inverse`), `m2m`. Skip `unsupported` (composite / ambiguous), cible invisible, FK absent du payload. |
| Direction dessin | FK : toujours enfant → parent, label = champ **owning**. m2m : une ligne non orientée, clé canonique. |
| Cycles | Set visité `(model, id)`. Nœud unique ; arête encore ajoutable. Opaque : jamais étendu. |
| Hors `listWhere` | Jamais `resolveLabel` sur un miss. Inverse : déjà filtré. Owning / m2m : nœud **opaque** (`#${id}`, pas de lien). |
| UX | Label action `Graph`. Titre `{Model.name} · {label}`. 1 nœud / 0 arête : nœud racine + hint `No related records in scope.` Nœud in-scope → edit. Lien Graph secondaire seulement si le modèle est dans `models`. Opaque : pas de lien. |
| Fan-out | Pas de cap (`listRecords` n’a pas de `take` ; on n’élargit pas l’API). Documenté. |
| Fake plugin | `tests/fixtures/fakeGraphPlugin.ts` **inchangé**. |
| `ctx.event` | Le plugin first-party **ne l’utilise pas**. |

## Approches écartées

1. **Export depuis `.`** — le graphe deviendrait une capacité de l’entrée principale ; le nord dit que `models` / `depth` appartiennent à la factory auteur.
2. **Package npm séparé** — second versioning pour un premier plugin first-party ; trop tôt.
3. **Svelte Flow / D3** — le Layout est du SSR string, jamais hydraté. Une lib de composants Svelte exigerait un IIFE pré-bundlé (pipeline Vite interdit) et gonflerait `dist`.
4. **JSON dans la page + SVG construit en JS** — page vide sans JS ; layout dans une string, cauchemar couverture.
5. **Un seul fichier factory+walk+viz** — non testable proprement.
6. **Élargir `AdminPlugin`** (nav, JSON, `take` sur `listRecords`, `labelTemplate` sur le ctx) — hors PR 3. Les labels du graphe utilisent `resolveLabel(model, row)` **sans** `models[].label` / `relations[].labelTemplate` (le ctx ne les expose pas). Limitation v1 acceptée.

**Retenu** : subpath first-party, quatre modules, SVG SSR.

## Architecture

Le core ne change pas. Au boot il reçoit un `AdminPlugin` comme n’importe quel autre. `depth` / `models` ne sortent pas de la factory.

```
createAdminHandler({ plugins: [relationGraphPlugin({ models, depth })] })
  └─ resolvePluginRegistry  // inchangé : name, pattern, models[]

GET /admin/user/1/graph
  ├─ match plugin avant builtins
  ├─ authCheck
  ├─ whitelist models + loadRecord racine (404 si miss, render non appelé)
  └─ page.render(ctx)
        ├─ walk(ctx, { depth, models })
        ├─ layout(graph)
        └─ { html: SVG+chrome, styles, scripts: pan/zoom }
```

```
src/lib/server/plugins/relation-graph/
  index.ts     relationGraphPlugin() → AdminPlugin
  walk.ts      ctx → { nodes, edges }
  layout.ts    graphe → x/y (pur)
  render.ts    graphe posé → PluginPageResult
```

Même schéma de chemins que Drizzle : source sous `src/lib/server/…`, `package.json` `exports` pointe vers `dist/server/plugins/relation-graph/`.

Export public du subpath : `relationGraphPlugin` + type `RelationGraphPluginOptions`. Pas `walk` / `layout` / `render`.

Le plugin first-party importe en interne `PluginPageContext`, `RelationEdge`, `Filter`. Il n’importe pas `createAdminRuntime`, n’utilise pas `ctx.event`, n’appelle pas l’adapter.

`src/lib/index.ts` : **aucun** nouvel export runtime (le test `RUNTIME_EXPORTS` à cinq fonctions reste vert).

## Composants

### `RelationGraphPluginOptions` / factory (`index.ts`)

```ts
export interface RelationGraphPluginOptions {
  /** Page + bouton Graph. Omis = tous les modèles visibles. */
  models?: string[];
  /** Hops BFS. Défaut 2. Entier 0..8. */
  depth?: number;
}

export function relationGraphPlugin(opts?: RelationGraphPluginOptions): AdminPlugin
```

- `name: 'relation-graph'`
- `pages`: une page, `pattern: [':model', ':id', 'graph']`, `models: opts.models` (propriété omise si `opts.models` est omis — pas `[]`)
- `recordActions`: `{ label: 'Graph', models: opts.models, href: ({ model, id, basePath }) => \`${basePath}/${model.toLowerCase()}/${id}/graph\` }`
- `render` : `async (ctx) => { const g = await walk(...); return renderGraphPage(ctx, layout(g)); }`

Validation **dans la factory** (throw avant même le registre si l’app appelle la factory au boot, ce qui est le cas) :

- `depth` omis / `undefined` → `2`
- sinon `Number.isInteger(depth) && depth >= 0 && depth <= 8`, sinon :

```
[sveltekit-admin] relationGraphPlugin: depth must be an integer in 0..8
```

`NaN`, `Infinity`, `2.5`, `-1`, `9` → throw. Pas de coercion `'2'` → `2`.

`models: []` : transmis tel quel. Aucune page Graph ne matchera (whitelist vide). Pas de throw factory ; le registre accepte un tableau vide.

`models` inconnus : throw **registre** existant, message inchangé.

### Walk (`walk.ts`)

```ts
export type GraphNode = {
  key: string;              // `${model}:${String(id)}` — `model` = nom schéma (`User`)
  model: string;
  id: string | number;
  label: string;            // resolveLabel(model, row) si in-scope ; `#${id}` si opaque
  opaque: boolean;
  href: string | null;      // `${basePath}/${model.toLowerCase()}/${id}` si !opaque
  graphHref: string | null; // même URL + `/graph` si !opaque ET modèle autorisé par opts.models
  depth: number;
};

export type GraphEdge = {
  from: string;             // node key
  to: string;
  field: string;            // champ owning (FK) ou champ m2m du côté de découverte
  kind: 'fk' | 'm2m';
};

export type WalkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
```

`graphHref` : `opts.models` omis → tout modèle visible in-scope. Sinon match **case-insensitive** comme `actionsForModel` (`n.toLowerCase() === model.toLowerCase()`).

Racine : `ctx.record` (garanti par le core). `id` = valeur du champ `@id` sur le record, sinon `ctx.route.id`. `findModel(ctx.route.model)` pour le modèle racine.

BFS. File `{ model, id, record, depth }`. `visited: Set<string>` de keys. Un nœud déjà visité : pas de second nœud, l’appelant peut encore enregistrer une arête. `node.depth >= maxDepth` : ne pas étendre. Opaque : jamais étendu (`record` absent).

`ctx.relationGraph == null` : `{ nodes: [racine], edges: [] }`.

Pour le modèle courant, parcourir `relationGraph.edges` dont `edge.model === current.model` (toutes les arêtes **sortantes du schéma** depuis ce modèle). Ordre : insertion Map (ordre de construction du graphe, stable).

| `edge.kind` | Action |
|---|---|
| `to-one-owning` | Skip si `unsupported` ou `scalarFields.length !== 1`. Soit `sf = scalarFields[0]`. Si `!(sf in record)` ou `record[sf] == null` → skip (FK hidden / null). `loadRecord(edge.target, record[sf])`. Hit → nœud in-scope (row). Miss → nœud opaque, `id = record[sf]`. Courant = enfant (il porte le FK). Arête FK : `from = courant`, `to = voisin`, `field = edge.field`. |
| `to-one-inverse` / `to-many-inverse` | Résoudre l’arête owning : **exactement une** arête avec `kind === 'to-one-owning'` && `target === current.model` && `relationName === edge.relationName` && `!unsupported` && `scalarFields.length === 1`. 0 ou >1 → skip. `listRecords(edge.target, { op: 'eq', field: owning.scalarFields[0], value: current.id })`. Chaque row → nœud in-scope. Courant = parent. Arête FK : `from = enfant`, `to = courant`, `field = owning.field`. |
| `m2m` | Skip si `unsupported`. `getM2mSelectedIds(current.model, edge.field, current.id)` puis `loadRecord(edge.target, id)` pour chaque id. Miss → opaque. Arête m2m : clé canonique `(relationName, min(keyA, keyB), max(keyA, keyB))` — une seule ligne même si l’autre côté est marchée plus tard. `field` = `edge.field` du **premier** insert. |
| autre | `never` exhaustif (les quatre `RelationKind` sont couverts). |

Cible `findModel(edge.target)` falsy (`exclude`, pivot masqué) : skip l’arête, pas de throw.

Self-ref : même algo ; le set visité coupe le cycle. Un User manager de lui-même : arête FK `from === to` autorisée. Layout : le nœud n’apparaît qu’une fois. Render : ligne `x1=x2,y1=y2` invisible → dessiner une **petite boucle** (arc) autour du nœud, label `field` inchangé.

`author` + `reviewer` vers le même User : deux arêtes FK, clés `(from, to, field)` distinctes.

Dédup FK : Map clé `${from}\0${to}\0${field}\0fk`. Dédup m2m : Map clé `${relationName}\0${min}\0${max}\0m2m`.

Nœud in-scope : `label = ctx.resolveLabel(targetModel, row)` (pas de 3ᵉ arg). Nœud opaque : `label = '#' + String(id)` ; **aucun** appel `resolveLabel` / `loadRecord` supplémentaire.

Ne pas marcher une arête owning dont le scalaire match `isSensitiveFieldName` s’il a été redacté (il n’est plus `in record`) — déjà couvert par `!(sf in record)`.

Pas de `ctx.event`. Pas de cap sur la longueur de `listRecords`.

### Layout (`layout.ts`)

Fonction pure `layout(graph: WalkGraph): LaidOutGraph`.

Constantes (exportées pour les tests) :

- `COL_W = 240`
- `ROW_H = 88`
- `NODE_R = 20`
- `PAD = 48`

Colonnes = `depth` (0 à gauche). Dans une colonne, nœuds dans l’ordre d’insertion du walk (stable), y = `PAD + index * ROW_H`. x = `PAD + depth * COL_W`.

`viewBox` / width / height = bounding box des centres ± `PAD + NODE_R`.

Graphe 1 nœud : une colonne, un centre, pas de branche spéciale.

### Render (`render.ts`)

`renderGraphPage(ctx, laidOut): PluginPageResult`.

Tout texte issu du graphe / du record passe par `ctx.escapeHtml` (titre, labels, `field`, `model`, `id`, hrefs interpolés dans des attributs).

HTML :

- Wrapper `.ska-rg`
- `h1.ska-rg__title` : `{escape(model.name)} · {escape(root.label)}`
- Si `edges.length === 0` : `<p class="ska-rg__hint">No related records in scope.</p>`
- Viewport `.ska-rg-viewport` (overflow auto, pour le no-JS) contenant le SVG
- SVG : groupe `.ska-rg-canvas` (cible du transform pan/zoom)
  - Arêtes d’abord : `<line>` + `<text>` au milieu (`field`). `kind === 'fk'` → `marker-end` flèche. `kind === 'm2m'` → pas de flèche, trait éventuellement `stroke-dasharray` léger pour les distinguer.
  - Nœuds : cercle `r=NODE_R` + `<text>` label (tronquer visuellement en CSS, le texte complet reste dans un `title` SVG escape). In-scope : enveloppé dans `<a href="{escape(href)}">`. Opaque : `<g class="ska-rg-node--opaque">`, cercle `stroke-dasharray`, fill atténué, **pas** de `<a>`. Si `graphHref` : un `<a class="ska-rg-node__graph">Graph</a>` à côté, pas à la place du lien edit.

Couleurs : `var(--ska-primary)` pour le nœud racine / les arêtes ; opaque = `#94a3b8` (déjà utilisé par `formatValue` pour les vides).

`styles` : classes préfixées `ska-rg-*` uniquement. Pas de CSS global.

`scripts` : **constante statique** (aucune interpolation de données). Attache pointer-drag + wheel zoom sur `.ska-rg-viewport` / `.ska-rg-canvas`. Clamp scale `0.4..3`. Pas de `fetch`. Sans JS : SVG visible, scroll natif du viewport.

### Packaging

`package.json` `exports`, calqué sur Drizzle :

```json
"./plugins/relation-graph": {
  "types": "./dist/server/plugins/relation-graph/index.d.ts",
  "svelte": "./dist/server/plugins/relation-graph/index.js",
  "default": "./dist/server/plugins/relation-graph/index.js"
}
```

Les tests du subpath importent le source (`src/lib/server/plugins/relation-graph/index.ts`), comme Drizzle. `RUNTIME_EXPORTS` de `.` inchangé.

## Flux de données

Exemple : User 1, `depth: 2`, Post.author → User, Post.tags m2m Tag, `listWhere` Tag exclut Tag 9.

1. Core `loadRecord('User', 1)` → `ctx.record` `{ id: 1, email: 'a@x.y' }` (pas de `posts`).
2. Walk étend User : inverse `posts` → `listRecords('Post', eq authorId 1)` → Post 5.
3. Arête FK `from=Post:5` `to=User:1` `field=author`.
4. Depth 1, étend Post 5 : owning `author` → User 1 déjà visité, arête dédup. m2m `tags` → ids `[2, 9]` ; Tag 2 `loadRecord` hit ; Tag 9 miss → nœud opaque `Tag` `#9`, pas de lien, pas d’extension.
5. Layout : col 0 User, col 1 Post 5 + Tag 2 + Tag 9.
6. Render : SVG dans `html`. List/edit User ont le lien Graph ; list/edit Post seulement si `models` omis ou contient `Post`.

Le JS inline ne relit pas Prisma. Pas de GET `/admin/_plugin/*.js`. Pas d’endpoint JSON.

## Erreurs et invariants

- Overlay `[':model', ':id', 'graph']` : n’est **pas** un overlay builtin (3 tokens, le 3ᵉ est le littéral `graph`). Pas de throw registre. Collision avec un autre plugin sur le même pattern → throw registre existant.
- `['graph']` n’est **pas** utilisé (éviterait le `:model/:id` mais casserait le nord `/admin/user/1/graph`).
- Page plugin plus stricte que l’edit : `/admin/user/1` peut 200 alors que `/graph` 404 si hors `listWhere`. On ne scope pas l’edit dans cette PR.
- Opaque : pas de label résolu, pas de href edit (l’edit est unscoped : un lien redeviendrait un oracle de navigation).
- XSS : `escapeHtml` sur labels / field / hrefs. Le script pan/zoom n’embarque aucune donnée DB.
- Auth 401 / POST 405 / assets uniquement sur cette requête : comportement core, characterization dans les tests du vrai plugin.
- `listWhere` `{}` : throw core (helpers), le plugin ne l’attrape pas.
- Invariants existants (liste, search, audit, fake plugin) : inchangés.

## Tests

`fakeGraphPlugin` **non modifié**. Fichiers nouveaux :

| Fichier | Rôle |
|---|---|
| `tests/unit/plugins/relation-graph/walk.test.ts` | Walk, ctx mocké (pas d’ORM) |
| `tests/unit/plugins/relation-graph/layout.test.ts` | Colonnes, 1 nœud, déterminisme, self-ref |
| `tests/unit/plugins/relation-graph/plugin.test.ts` | Factory : name, pattern, label, href, défaut depth, throw depth, `models` omis vs transmis |
| `tests/unit/plugins/relation-graph/render.test.ts` | HTML : titre, hint 0 arête, opaque sans `<a>` edit, escape, classes `ska-rg-*`, `scripts` constante |
| `tests/unit/plugins/relation-graph/handler.test.ts` | GET réel via `createAdminHandler` + ce plugin |
| `tests/unit/plugins/relation-graph/exports.test.ts` | Subpath : `relationGraphPlugin` est une fonction ; `.` n’exporte pas la factory |

Cas walk (non exhaustif mais bloquant) :

- owning FK → nœud + arête enfant→parent
- inverse to-many + to-one
- m2m + id hors scope → opaque, pas de `resolveLabel`
- cycle A↔B : 2 nœuds, arêtes dédup
- `depth: 0` : racine, 0 arête
- `depth: 2` n’étend pas le niveau 2
- hidden / absent FK : pas d’arête
- `unsupported` composite / ambiguous : skip
- cible `exclude` : skip
- `relationGraph` null : racine seule
- author + reviewer : 2 arêtes
- self-ref manager : 1 nœud, arête éventuellement réflexive
- `models: ['User']` : `graphHref` null sur un nœud Post in-scope ; `href` edit présent

Cas handler :

- GET `/admin/user/1/graph` → Layout + SVG, pas de payload JSON
- assets absents de list / edit / dashboard
- liste + edit User : lien `Graph` avant Edit, href correct
- create User : pas d’action
- POST `/admin/user/1/graph` → 405
- `listWhere` exclut l’id → NotFound, pas de `.ska-rg` (le core n’appelle pas `render`)
- `{ prisma }` et `{ adapter }` servent la page

## Docs / changeset

- `docs/src/lib/content/docs/plugins.svx` : import subpath, exemple `relationGraphPlugin({ models, depth })`, options, sécu (opaque, `listWhere`, pas d’objets relation), first-party = subpath / tiers = leur package, fan-out non borné, labels sans `labelTemplate`.
- `configuration-reference.svx` : pas de nouvelle clé core.
- README : une puce / phrase + lien docs Plugins.
- Changeset **minor** (`writing-changesets`) : nouvel export `sveltekit-admin/plugins/relation-graph` / `relationGraphPlugin`. Pas patch. Le body dit que `createAdminHandler({ prisma })` sans `plugins` est inchangé.

## Hors périmètre

- Élargir `AdminPlugin` ou exporter `createAdminRuntime`
- Endpoint JSON, fichiers `.js` servis, CSP, Vite, Svelte Flow, D3
- Cap de fan-out / `take` sur `listRecords`
- Scoper edit / delete / dashboard counts
- Nav sidebar plugin
- Transformer `fakeGraphPlugin` en vrai graphe
- Export `relationGraphPlugin` depuis `.`
- Brancher le plugin dans `example/` (hors tests ; le consommateur l’ajoute s’il veut)
- `models[].label` / `relations[].labelTemplate` sur les nœuds (ctx insuffisant)
