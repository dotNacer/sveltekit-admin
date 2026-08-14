# Adapter Drizzle (design)

## Contexte

La spec [db-adapter-abstraction](./2026-08-13-db-adapter-abstraction-design.md) a extrait `SchemaIntrospector` / `DataAdapter` / `Filter`. Prisma est un adapter derrière `createAdminHandler({ prisma })` ou `createAdminHandler({ adapter: createPrismaAdapter(...) })`. Aucun comportement Prisma n’a changé.

Cette spec est la suite promise : **parité fonctionnelle Prisma** pour une app SvelteKit + Drizzle (list, form, dashboard, relations to-one / to-many / m2m, filtres, recherche, scoping `listWhere`). Les ORM suivants (Kysely, …) ne sont pas traités ici — Drizzle est le deuxième adapter qui **prouve** les interfaces.

Contraintes héritées, non négociables :

- `vitest.config.ts` : 100 % de couverture (lines/statements/functions/branches) sur `src/lib/**`, sans `exclude` ni `v8 ignore`.
- Zéro changement observable pour `createAdminHandler({ prisma, prismaSchemaPath })` : characterization + `tests/integration/handler.db.test.ts` passent **sans modification**.
- `handler.ts` ne gagne pas de `prisma[...]` de retour, ni de raccourci `{ drizzle }`. Drizzle entre uniquement par `config.adapter`.
- Le `Schema` lingua franca (`Int` / `String` / `DateTime` / …) n’est pas redessiné. L’introspecteur Drizzle **traduit** vers cette forme. `buildRelationGraph` n’est pas réécrit.

## Objectif

- `createDrizzleAdapter({ db, schema, dialect?, searchMode? })` → `{ introspector, data }`, même contrat que `createPrismaAdapter`.
- Import depuis **`sveltekit-admin/adapters/drizzle`** (pas l’entry `.`).
- `@prisma/client` et `drizzle-orm` en peers **optionnelles**. Un projet Drizzle-only n’installe plus Prisma.
- Dialectes SQL : PostgreSQL, MySQL, SQLite. Les drivers (Neon, `postgres.js`, `better-sqlite3`, …) sont hors spec : on consomme l’instance `db` déjà construite.
- Introspection **synchrone** sur l’objet runtime `import * as schema from './db/schema'` (tables + `relations()` v1). Pas de parse de fichiers, pas de snapshot drizzle-kit.
- `Model.name` = clé d’export JS (`users`), pas le nom SQL, pas de singularisation PascalCase.
- `listWhere` / `relations[x].where` : un objet plat `{ tenantId: 1 }` et un `Filter` AST marchent sur Prisma **et** Drizzle. Un `where` Prisma imbriqué reste Prisma-only ; Drizzle throw au compile (fail loud).

## Architecture

```
createAdminHandler({ adapter: createDrizzleAdapter({ db, schema }) })
        │
        ▼
introspect() synchrone ─▶ Schema (lingua franca) + map m2m privée (fermée dans data)
        │
buildRelationGraph(schema)     ← inchangé
        │
requête ─▶ adapter.data.*      ← query builder drizzle, pas db.query
```

Usage consommateur :

```ts
import { createAdminHandler } from 'sveltekit-admin';
import { createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';

export const handle = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: /* ... */
});
```

`createDrizzleAdapter` introspecte une fois à la construction (comme `createPrismaAdapter`), mémoïse le `Schema`, et construit `data` avec : les `Table` indexées par export JS, le dialecte, `caseInsensitiveSearch`, et la map m2m `{ 'users.groups' → { pivot, selfColumn, otherColumn, targetTable } }`.

Le consommateur n’a **pas** besoin d’avoir fait `drizzle(client, { schema })`. Seul le query builder est utilisé.

## Composants

### Packaging

- `package.json` `exports["./adapters/drizzle"]` → `dist/server/adapters/drizzle/index.js` (+ types).
- `peerDependencies` : ajouter `drizzle-orm` `>=0.32.0` (API `relations()` v1 stable ; 0.36+ introduit `defineRelations` v2, hors spec, mais v1 reste importable). Garder `@prisma/client` `>=5.0.0`.
- `peerDependenciesMeta` : `@prisma/client` **et** `drizzle-orm` `{ optional: true }`.
- `devDependencies` : `drizzle-orm` + un driver SQLite (`better-sqlite3` ou équivalent) pour les tests d’intégration.
- Entry `.` : **n’importe pas** `drizzle-orm`. `createDrizzleAdapter` n’est pas réexporté par `src/lib/index.ts`. `RUNTIME_EXPORTS` du test d’entry inchangé.
- Changeset **minor**. README : snippet Drizzle. `config.search.mode` documenté comme chemin `{ prisma }` only ; l’adapter explicite prend `searchMode` sur la factory (déjà le cas de `createPrismaAdapter`).

### `src/lib/server/adapters/drizzle/`

- `introspector.ts` — objet `schema` → `Schema`.
- `filterCompiler.ts` — `Filter` → `SQL` drizzle (`eq` / `and` / `or` / `like` / `ilike` / `inArray` / `isNull` / …).
- `dataAdapter.ts` — `DataAdapter` via query builder.
- `index.ts` — `createDrizzleAdapter`.

### Introspecteur

Parcours de `Object.entries(schema)` :

- Un export est un **modèle** ssi c’est une Table drizzle (`is(x, Table)` + helpers publics `getColumns` / `getTableConfig` selon dialecte). Un export `relations()` v1 se reconnaît via le helper public drizzle (`is(x, Relations)` s’il existe, sinon la forme `{ table, config }` documentée par `relations()` — verrouillée par test contre la peer min). Tout le reste (enums, `defineRelations` v2, helpers) n’est pas un modèle. Les enums (`pgEnum`, …) alimentent `Schema.enums`.
- `Model.name` = clé d’export. Les noms de `Field` scalaires = clés JS sur la table (`authorId`, pas `author_id`). Les requêtes utilisent les objets colonne, pas les identifiants SQL bruts.
- Dialecte : `dialect` optionnel, sinon inféré (`is(table, PgTable)` / `MySqlTable` / `SQLiteTable`). Tables mixtes → throw à la construction. `Schema.provider` = `'postgresql' | 'mysql' | 'sqlite'`.
- Mapping de types (colonne → lingua franca) :

  | Drizzle (indicatif) | `Field.type` |
  | --- | --- |
  | text / varchar / uuid / char | `String` |
  | integer / serial / smallint | `Int` |
  | bigint / bigserial | `BigInt` |
  | real / double / float | `Float` |
  | numeric / decimal | `Decimal` |
  | boolean | `Boolean` |
  | timestamp / timestamptz / date / integer `{ mode: 'timestamp' }` | `DateTime` |
  | json / jsonb | `Json` |
  | blob / bytea | `Bytes` |

  Enums (`pgEnum`, enum MySQL, `column.enumValues`) : `isEnum: true`, membres dans `Schema.enums`. Type du champ = nom d’enum si disponible, sinon `String` + `isEnum`.
- `isId` : PK **simple** sur une colonne. PK composite : aucun `isId` inventé ; `primaryKeyOf` / `coerceId` retombent sur le fallback `'id'` déjà existant (même limitation qu’un `@@id` Prisma mal couvert). Pas de PK synthétique.
- `isRequired` ← `notNull`. `hasDefault` ← `hasDefault`. `isUnique` ← unique simple.
- `isCreatedAt` / `isUpdatedAt` : heuristique nom `createdAt`/`created_at` / `updatedAt`/`updated_at` **et** type `DateTime` (Drizzle n’a pas `@updatedAt`).
- Schéma vide / aucune table : `Schema.models = []`, pas de throw (équivalent du parse Prisma dégradé).

**Relations — `relations()` v1 seulement.** Forme :

```ts
relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id], relationName?: string }),
  comments: many(comments, { relationName?: string })
}))
```

`defineRelations` v2 (et `through:`) est hors spec : un export v2 n’est pas reconnu comme source d’arêtes (dégradation, pas de throw).

Règles :

- `one({ fields, references })` → champ relation avec `relation.fields` (owning). `one` sans `fields` / `many(table)` → inverse, sans `fields`.
- `relationName` drizzle → `Field.relation.name` (règle d’or : deux relations vers le même modèle).
- Pas de `relations()` dans l’objet → **aucune arête**. Les `.references()` sur colonnes restent des scalaires FK. On **n’invente pas** `author` depuis `authorId`. Boot ne throw pas.
- `buildRelationGraph` consomme le `Schema` produit, sans changement d’algorithme.

**M2M (parité checkboxes).** Drizzle n’a pas le N-N implicite Prisma : le pivot est une vraie table, et `many()` pointe souvent vers le pivot.

Détection d’un pivot « pur » :

- exactement 2 `one({ fields })` sur le pivot, vers A et B **distincts** (pas de self-ref : les deux FK vers le même modèle rendraient un seul nom synthétisé, on n’invente pas `followers`/`following`) ;
- peu ou pas de colonnes métier (même esprit que `detectPivotTable` actuel) ;
- A et B exposent chacun `many(pivot)`.

Alors :

- `isPivotTable: true` sur le modèle pivot (masqué si `hidePivotTables`, défaut inchangé) ;
- on **synthétise** sur A et B un champ liste **sans** `fields:` nommé d’après l’export du modèle **opposé** (`users` gagne `groups`, `groups` gagne `users`) → le graphe actuel classe `m2m` ;
- on **n’émet pas** le `many(pivot)` comme arête to-many à côté du m2m (sinon double UI) ;
- collision de nom (champ déjà présent), self-ref, ou plus d’un pivot entre le même couple → **pas** de champ synthétisé ; `many(pivot)` reste un to-many vers le pivot. Diagnostic `ambiguous` seulement en cas de collision / multi-pivot.

L’adapter garde en **privé** (pas sur `Schema`) la map `users.groups` → `{ pivot, selfColumn, otherColumn, targetTable }`. Prisma n’a pas besoin de `through`.

Sans pivot détectable, `many(pivot)` reste un to-many vers le pivot (équivalent d’un join model Prisma explicite).

### `Filter` : `containsExact`, sucre plat, compilers

**`containsExact`** — nouvelle feuille de `LeafFilter` :

```ts
op: 'eq' | 'contains' | 'containsExact' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull'
```

- Liste `?q=` : continue d’émettre `contains` (soumis à `caseInsensitiveSearch` côté compiler).
- Endpoint `_search` : **arrête** d’injecter `{ [field]: { contains: q } }` (opaque Prisma). Émet `{ op: 'containsExact', field, value: q }` composé en `and` avec le scope. Comportement Prisma : `{ field: { contains: q } }` **sans** `mode`. Drizzle : `like`, jamais `ilike`.

Les prédicats structurels `isCompositeFilter` / `isLeafFilter` (aujourd’hui privés au compiler Prisma) sont extraits dans un module partagé (`adapters/filter.ts` ou équivalent) : `LEAF_OPS` inclut `containsExact`. Les deux compilers et `buildWhere` s’en servent. Discrimination toujours structurelle (jamais `'op' in node` seul) — invariant sécu du refactor.

**Sucre plat dans `buildWhere`.** Avant d’empiler `scope` :

1. Si `isLeafFilter` / `isCompositeFilter` → déjà un `Filter`, tel quel.
2. Sinon si objet dont **toutes** les valeurs sont scalaires (`string` | `number` | `boolean` | `bigint` | `Date` | `null` — pas `undefined`, pas tableau) → une clé : feuille `eq` ; plusieurs : `{ op: 'and', clauses: eq[] }`. `{ tenantId: 1 }` compile côté Prisma en `{ tenantId: 1 }` — HTML characterization inchangé ; seuls les asserts unitaires sur la forme `Filter` du scope bougent.
3. Sinon (valeur objet, tableau, `undefined` : `{ author: { is: … } }`, `{ id: { in: […] } }`) → opaque, inchangé. Drizzle throw au compile.

`{}` continue de throw **dans le handler** avant `buildWhere` (fail-open interdit).

**Compiler Prisma** : nouveau `case 'containsExact'` → `{ [field]: { contains: value } }` sans `mode`. Pass-through opaque inchangé. `switch` exhaustif (`never` / pas de `default` fictif).

**Compiler Drizzle** : unique endroit qui importe `eq` / `and` / `or` / `like` / `ilike` / `inArray` / `isNull` / `gte` / `lte` / `lt` depuis `drizzle-orm`. Champ inconnu → throw. Nœud opaque → throw avec message explicite (*nested Prisma `where` is not supported by the Drizzle adapter; return a Filter or a flat `{ field: scalar }` map*). Jokers `%` et `_` échappés dans `contains` / `containsExact` / `startsWith`.

`caseInsensitiveSearch` (figé à la construction de `data`) :

- `searchMode === 'insensitive'` → true ;
- `searchMode === 'default'` → false ;
- `'auto'` (défaut) → true seulement si `provider === 'postgresql'` (même liste d’esprit que Prisma : pas mysql, pas sqlite).

`contains` → `ilike` si true, `like` sinon. `containsExact` → toujours `like`. `config.search.mode` du handler **n’est pas** rétro-injecté dans un adapter déjà construit.

### `DataAdapter` Drizzle

Ferme sur `db`, tables, dialecte, compiler, map m2m. Query builder uniquement.

- **Reads** : `select().from(table)` + `where` + `limit`/`offset`. Lignes en **clés JS**. `listRecords` : `orderBy` PK desc + `count` en `Promise.all`. `getRecord` / `findFirst` : une ligne ou `null`. `orderBy` config : chaque entrée → `asc`/`desc(colonne)` ; clé inconnue → throw.
- **Writes scalaires** : `insert` / `update` / `delete`. `formDataToPrisma` **n’est pas renommé** : il branche déjà sur les types lingua franca.
- **M2M** (si `input.m2m` a au moins une clé) dans `db.transaction` :
  - create : insert parent → insert des lignes pivot `(selfFk, otherFk)` pour chaque id ;
  - update : sémantique Prisma `set` — `delete` pivot `where selfFk = id`, puis insert (liste vide = detach all).
- **`getM2mSelectedIds`** : `select` la colonne « autre » du pivot. Map absente → `[]`.
- **`returning()`** : Postgres et SQLite via `.returning()`. MySQL : pas de `returning` portable → insert puis `select` par PK (`insertId` ou PK fournie). Le handler ignore aujourd’hui la row (redirect 303) mais le contrat `Promise<Record<string, unknown>>` doit tenir.
- Pas de nouveau `try/catch` swallow dans l’adapter. Les filets restent ceux du handler (dashboard count 0, options vides, `_search` 500).

### Handler (tweaks minimaux hors `adapters/drizzle/`)

- `_search` : `containsExact` (plus d’opaque `{ contains }`).
- `buildWhere` : normalisation du scope plat (ci-dessus).
- Message boot : « Could not parse Prisma schema » → « Could not introspect schema » (le `catch` couvre déjà tout introspecteur).
- Aucun import drizzle dans `handler.ts`.

## Sécurité (invariants à ne pas réouvrir)

Inchangés, et valables pour Drizzle parce que le handler n’a pas divergé :

- Champ `hidden` / `isSensitiveFieldName` : injoignable en list, `?q=`, `?f.*=`.
- `listWhere` ne scope que la liste. Detail / edit / delete / dashboard counts restent ouverts.
- `listWhere` / `where` qui renvoie `{}` → throw.
- POST FK / m2m revalidés via `adapter.data.findFirst` / `findMany` + le même scope.
- Chip FK hors scope : id brut, jamais un label (oracle).
- Compiler : discrimination structurelle du `Filter` ; Drizzle ne fail-open pas sur un opaque.

## Tests

- Characterization Prisma + `handler.db.test.ts` + `handler.m2m.db.test.ts` : **zéro diff**.
- `tests/integration/setup.ts` : **non modifié**. L’intégration Drizzle bootstrappe son propre SQLite en mémoire dans le fichier de test.
- Unitaires `tests/unit/adapters/drizzle/` : introspecteur (tables, enums, `one`/`many`, pivot→m2m, collision → pas de synthèse, sans `relations()` → pas d’arêtes, dialecte mixte → throw), compiler (chaque op, `ilike` vs `like`, `containsExact`, opaque → throw, `%` échappé), factory (`dialect` inféré / override, `searchMode`).
- `tests/unit/listQuery.test.ts` : scope plat → feuilles `eq` ; scope imbriqué → opaque.
- `tests/unit/adapters/prisma/filterCompiler.test.ts` : `containsExact` ; scope plat désormais reçu en `eq` (même `where` Prisma compilé).
- `tests/unit/search.test.ts` : `_search` n’émet plus d’objet `{ contains }` Prisma ; la case-sensitivity de l’endpoint reste indépendante de `caseInsensitiveSearch`.
- Intégration `tests/integration/handler.drizzle.db.test.ts` : schéma fixture miroir (users / posts / tags + pivot), list / create / update / delete, FK + revalidation POST, m2m set/replace lu depuis le pivot réel, `listWhere` plat, nested `where` → erreur. `createAdminHandler({ adapter: createDrizzleAdapter(...) })` uniquement.
- Export sous-chemin : `createDrizzleAdapter` est une fonction ; pas présent sur l’entry `.`.
- Coverage 100 % y compris chaque branche du compiler et les chemins m2m create vs update vs scalaire seul.

## Compatibilité API publique

```ts
// Prisma — inchangé
createAdminHandler({ prisma, prismaSchemaPath: './prisma/schema.prisma' });

// Drizzle — nouveau
createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema })
});
```

- Nouvel export de sous-chemin : `createDrizzleAdapter`.
- `Filter` / `LeafFilter` : ajout de `'containsExact'` (élargissement de union, non breaking pour les consommateurs qui ne matchent pas l’union).
- `listWhere` plat : Prisma compile toujours `{ tenantId: 1 }` pour un égal simple.
- Types `Prisma*` / `createPrismaAdapter` / `createAdminHandler({ prisma })` : inchangés.

## Hors périmètre

- `defineRelations` v2 et `through:`.
- Parser `schema.ts` / snapshots drizzle-kit.
- Raccourci `createAdminHandler({ drizzle, schema })`.
- Kysely et tout autre ORM.
- Rename de `formDataToPrisma` / `toPrismaModel`.
- `introspect()` async (l’interface l’autorise ; le handler throw encore si Promise — inchangé).
- Exécuter un `where` Prisma imbriqué côté Drizzle.
- Inventer un nom de relation depuis `authorId`.
- Synthèse m2m self-référentielle (`followers` / `following`).
- Site `docs/` et app `example/` Drizzle (suivi).
- Drivers spécifiques au-delà de « on prend `db` ».
