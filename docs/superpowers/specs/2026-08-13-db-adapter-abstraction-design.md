# Abstraction DbAdapter (design)

## Contexte

Aujourd'hui, `sveltekit-admin` est câblé directement sur Prisma à trois niveaux :

- **Introspection** : `introspection/parser.ts` parse un fichier `.prisma` par regex (pas de SDK Prisma) et produit `PrismaSchema`/`PrismaModel`/`PrismaField` — des types déjà assez génériques dans leur *forme* (nom/type/nullable/liste/unique/id/relation), malgré leur nom.
- **Relations** : `introspection/relations.ts` classe les paires de champs relationnels (`to-one-owning`/`to-one-inverse`/`to-many-inverse`/`m2m-implicit`) à partir de `PrismaSchema`. L'algorithme de pairing est agnostique ; seule la détection du m2m repose sur une notion propre à Prisma (deux champs `isList` sans `fields:` déclaré = table de jointure implicite auto-générée).
- **Exécution** : `data.ts` (5 fonctions CRUD fines) et surtout `handler.ts` (~8 sites d'appels directs à `prisma[modelKey].findMany/findUnique/count/create/update/delete`, y compris la syntaxe d'écriture relationnelle `connect`/`set` et la lecture imbriquée `include` pour le m2m) parlent tous les deux au client Prisma brut, typé `any`.

But du projet plus large : ajouter le support de Drizzle, avec une parité fonctionnelle complète (list/form/dashboard, relations to-one/to-many/m2m, filtres, tri, recherche). Vu l'ampleur, le travail est découpé en deux specs séquentielles :

1. **Ce document** — extraire une couche d'abstraction générique derrière laquelle Prisma devient *un* adapter parmi d'autres, sans changer aucun comportement observable. Pur refactor interne.
2. **Spec suivante** (non traitée ici) — implémenter `createDrizzleAdapter`, en s'appuyant sur les interfaces posées ici.

Contrainte non négociable pendant tout le refactor : `vitest.config.ts` impose 100% de couverture (lines/statements/functions/branches) sur `src/lib/**`, sans `exclude` ni `v8 ignore` (mémoire `coverage-gate-policy`). Les tests `tests/characterization/*` et `tests/integration/handler.db.test.ts` (SQLite réel via `prisma db push`) servent de filet de non-régression comportementale pendant ce refactor.

## Objectif

- Introduire deux interfaces génériques — `SchemaIntrospector` (boot) et `DataAdapter` (par requête) — dont `createPrismaAdapter({ prisma, schemaPath })` est la première implémentation.
- **Zéro breaking change** : `createAdminHandler({ prisma, prismaSchemaPath, ... })` continue de fonctionner à l'identique ; en interne, cette forme legacy construit un `createPrismaAdapter(...)` avant toute autre logique. Un nouveau champ `adapter` optionnel permet de fournir directement une implémentation (utilisé par la spec Drizzle à venir).
- Les types publics `PrismaSchema`/`PrismaModel`/`PrismaField` restent exportés à l'identique (en tant qu'alias des nouveaux types génériques `Schema`/`Model`/`Field`) — aucun consommateur ne voit de différence de type.
- `createPrismaAdapter` reste exporté depuis le point d'entrée principal (`@prisma/client` est déjà une peerDependency utilisée par défaut) : le pattern "sous-chemin d'export séparé" n'est pas nécessaire ici, il sera introduit dans la spec Drizzle pour éviter de forcer `drizzle-orm` chez les consommateurs Prisma-only.

## Architecture

```
createAdminHandler(config)
  ├─ config.prisma présent (legacy) ─▶ createPrismaAdapter({ prisma, schemaPath })
  └─ config.adapter fourni ──────────▶ utilisé directement
                                              │
                                    { introspector, data }
                                              │
                    boot ──▶ introspector.introspect() ──▶ Schema
                                    │
                              buildRelationGraph(schema) ──▶ RelationGraph
                                    │
                    requête ──▶ handler.ts appelle adapter.data.*(...)
```

`handler.ts` ne référence plus jamais `prisma` directement : tous les sites d'appel actuels (`loadRelationOptions`, `loadSelectedIds`, `resolveFkFilterOptions`, `loadRelatedCounts`, `handleSearch`, comptage dashboard, revalidation FK/m2m en POST) passent par `adapter.data`.

## Composants

**`src/lib/server/types/schema.ts`** *(nouveau)*
Types génériques extraits de `parser.ts` : `Schema`, `Model`, `Field`, `Enum`. Forme inchangée par rapport à `PrismaSchema`/`PrismaModel`/`PrismaField` actuels — c'est un renommage, pas une refonte de shape.

**`src/lib/server/adapters/types.ts`** *(nouveau)*

```ts
interface SchemaIntrospector {
  introspect(): Schema | Promise<Schema>;
}

interface DataAdapter {
  /** Vue liste paginée d'un modèle : toujours tri PK desc, toujours count + fetch ensemble. */
  listRecords(model: Model, opts: { filter?: Filter; skip: number; take: number }):
    Promise<{ rows: Record<string, unknown>[]; total: number }>;
  /**
   * Lecture générale sans pagination forcée : options de relation FK/m2m,
   * options de filtre FK sidebar, endpoint `_search`. `orderBy` est le
   * `Record<string, 'asc'|'desc'>` déjà exposé tel quel dans
   * `AdminHandlerConfig.models[].relations[field].orderBy` (shape Prisma
   * publique existante, inchangée par cette spec) — l'adapter le transmet
   * de façon opaque.
   */
  findMany(model: Model, opts: { filter?: Filter; orderBy?: Record<string, 'asc' | 'desc'>; skip?: number; take?: number }):
    Promise<Record<string, unknown>[]>;
  getRecord(model: Model, id: string | number): Promise<Record<string, unknown> | null>;
  findFirst(model: Model, filter: Filter): Promise<Record<string, unknown> | null>;
  countRecords(model: Model, filter?: Filter): Promise<number>;
  createRecord(model: Model, input: { scalars: Record<string, unknown>; m2m?: Record<string, Array<string | number>> }):
    Promise<Record<string, unknown>>;
  updateRecord(model: Model, id: string | number, input: { scalars: Record<string, unknown>; m2m?: Record<string, Array<string | number>> }):
    Promise<Record<string, unknown>>;
  deleteRecord(model: Model, id: string | number): Promise<void>;
  /** `targetModel` est fourni par l'appelant (déjà résolu côté handler.ts dans tous les sites d'appel actuels) : évite de faire porter au Schema complet par l'adapter juste pour cette résolution de PK. */
  getM2mSelectedIds(model: Model, edge: RelationEdge, targetModel: Model, recordId: string | number): Promise<Array<string | number>>;
}

type Filter =
  | { op: 'and' | 'or'; clauses: Filter[] }
  | { op: 'eq' | 'contains' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull'; field: string; value?: unknown };
```

`createRecord`/`updateRecord` reçoivent scalaires **et** liens m2m ensemble : c'est l'adapter qui garantit l'atomicité (transaction), pas `handler.ts`. Ça évite tout état partiel si l'écriture des liens échoue après celle des scalaires, et ça laisse `handler.ts` totalement ignorant de la façon dont chaque ORM représente une relation m2m.

**`src/lib/server/adapters/prisma/`** *(nouveau)*
- `introspector.ts` — enrobe `parsePrismaSchema` existant tel quel (implémente `SchemaIntrospector`).
- `filterCompiler.ts` — compile `Filter` → objet `where` Prisma (`AND`/`OR`/`contains`/`startsWith`/`gte`/`lte`/`equals`/`not`/`mode: insensitive`). C'est l'ancien code de fin de pipeline de `listQuery.ts#buildWhere`, déplacé tel quel, comportement inchangé.
- `dataAdapter.ts` — implémente `DataAdapter` : les 5 fonctions actuelles de `data.ts` deviennent des méthodes ; `createRecord`/`updateRecord` n'enrobent l'écriture dans `prisma.$transaction(...)` que si `input.m2m` porte au moins une clé (le cas scalaire seul, très majoritaire, garde un `create`/`update` direct — pas de transaction inutile) ; `getM2mSelectedIds` reprend la logique actuelle de `loadSelectedIds` (`findUnique({ include: { [field]: true } })`). Le tri par clé primaire descendante (seul ordre utilisé par la vue liste, jamais configurable) reste interne à `listRecords` — pas de paramètre `orderBy` sur cette méthode, puisqu'aucune valeur autre que "PK desc" n'est jamais produite pour elle par le reste du code.
- `index.ts` — exporte `createPrismaAdapter({ prisma, schemaPath }): { introspector, data }`.

**`introspection/relations.ts`** — inchangé dans son algorithme de pairing, prend désormais `Schema` (alias, même shape) en entrée. Renommage interne `'m2m-implicit'` → `'m2m'` : `RelationKind` n'est pas exporté publiquement (seuls `PrismaSchema`/`PrismaModel`/`PrismaField`/`createAdminHandler`/`AdminHandlerConfig`/`defaultAdminCheck`/`parsePrismaSchema`/`parseSchemaContent` le sont), donc pas de breaking change. Le nom "implicite" est spécifique à Prisma (table de jointure auto-générée) et deviendra trompeur une fois Drizzle dans la boucle (toujours une table pivot explicite) — le renommage se fait maintenant pour éviter de le refaire dans la spec suivante.

**`query/listQuery.ts`** — le pipeline `parseListQuery`/`allowedOpsFor`/`coerceValue`/`resolveDateShortcut`/etc. (déjà agnostique selon l'exploration du code) reste inchangé. Seule `buildWhere` change de type de retour : elle produit désormais un `Filter` générique au lieu d'un objet `PrismaWhere`, en réutilisant exactement la même logique de composition `AND`/scope/recherche qu'aujourd'hui — juste exprimée dans le vocabulaire `Filter` plutôt que directement en `PrismaWhere`. Le type `PrismaWhere` disparaît de ce fichier (il n'est pas exporté publiquement).

**`handler.ts`** — chaque site d'appel direct à `prisma[...]` est remplacé par l'appel `DataAdapter` équivalent. Le pattern try/catch → fallback silencieux (count à 0, options vides, `tooMany: true`) est conservé à l'identique ; il devient même plus honnête, puisqu'il capture désormais n'importe quelle erreur d'`DataAdapter` plutôt que de supposer implicitement la sémantique d'erreur de Prisma.

## Compatibilité API publique

```ts
// Avant (continue de marcher à l'identique) :
createAdminHandler({ prisma, prismaSchemaPath: './schema.prisma', models: {...} });

// Nouveau, équivalent explicite (utile pour Drizzle plus tard) :
createAdminHandler({ adapter: createPrismaAdapter({ prisma, schemaPath: './schema.prisma' }), models: {...} });
```

`index.ts` exporte en plus : `type DataAdapter`, `type SchemaIntrospector`, `type Filter`, `createPrismaAdapter`. Les alias `PrismaSchema = Schema`, `PrismaModel = Model`, `PrismaField = Field` sont réexportés sans changement de forme.

## Tests

- `tests/fixtures/prismaMock.ts` reste le substrat de mock — `createPrismaAdapter` l'enrobe d'une couche supplémentaire, il ne le remplace pas. Un seul ajout nécessaire : `mock.$transaction(fn)` qui invoque `fn(mock)` directement (transaction interactive triviale — le mock n'a pas de vraie isolation transactionnelle, seule la forme d'appel compte pour les tests). Toutes les assertions existantes sur `callsTo(prisma, model, method)` restent valides à l'identique : `tx` passé au callback est le même objet mock, donc les mêmes `calls` sont journalisés que sans transaction.
- Nouveaux tests unitaires ciblés : `filterCompiler.ts` (port direct des tests actuels de `buildWhere`, mêmes cas, assertions sur la forme `Filter` puis sur le `where` Prisma compilé), `dataAdapter.ts` (chaque méthode contre `prismaMock`, y compris le chemin transactionnel m2m).
- `tests/characterization/*` et `tests/integration/handler.db.test.ts` (SQLite réel) doivent passer sans aucune modification — c'est le critère d'acceptation du "zéro changement de comportement".
- Coverage 100% sans exception : chaque nouvelle branche (notamment dans `dataAdapter.ts` pour les chemins m2m create vs update, et dans `filterCompiler.ts` pour chaque opérateur) a un test dédié.

## Hors périmètre

- Aucune implémentation Drizzle dans cette spec — seules les interfaces sont conçues en ayant ses contraintes en tête (pas de m2m implicite, où-clause par fonctions composables plutôt que par objet imbriqué), pour éviter une réouverture de `DataAdapter`/`Filter` à la spec suivante.
- Aucun changement du packaging (`exports` dans `package.json`) — `createPrismaAdapter` reste dans l'entry point principal.
- Aucun changement de comportement fonctionnel, de HTML rendu, ou de forme des types publics existants.
