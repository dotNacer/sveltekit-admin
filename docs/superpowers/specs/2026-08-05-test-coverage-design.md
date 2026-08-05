# Couverture de test complète — sveltekit-admin

**Date** : 2026-08-05
**Version de départ** : 0.2.1 (zéro test)
**Version cible** : 0.3.0 (breaking change assumé, pré-1.0)

## Problème

Le package n'a aucun test. `vitest` figure dans les devDependencies et `"test": "vitest"` dans les scripts, mais il n'existe ni configuration de test, ni fichier `*.test.ts`, ni provider de coverage. ~3 900 lignes de code non vérifiées, dont un handler HTTP de 1 050 lignes qui génère du HTML par concaténation de chaînes.

Écrire des tests sur l'état actuel poserait deux problèmes :

1. **Une partie du code est inatteignable ou orpheline.** Le commit `459af21` (v0.2.0, « standalone admin handler - zero routes needed ») a ajouté `src/lib/server/handler.ts` et supprimé les 10 fichiers `src/routes/admin/**` qui étaient les seuls consommateurs de `src/lib/admin.ts` et des 3 composants Svelte. Depuis, ces 1 800 lignes ne sont appelées par aucun code du package et ne sont mentionnées nulle part dans le README. `src/plugin.ts` et `src/index.ts` sont dans `src/`, pas `src/lib/` : `svelte-package -o dist` ne les produit pas et `files: ["dist"]` ne les publie pas — aucun consommateur ne peut les importer.
2. **`handler.ts` mélange trois responsabilités** (routing, accès aux données, génération HTML) et réimplémente en interne ce que `src/lib/server/crud/operations.ts` fait déjà : pagination, coercion d'ID, conversion `FormData` → types Prisma. Deux implémentations parallèles des mêmes règles, dont une seule est exécutée. Atteindre 100 % de couverture sur ce monolithe donnerait de gros tests de bout en bout où un échec n'indique pas ce qui est cassé.

`example/` n'atténue rien : il n'importe pas le package, il embarque une copie vendorée dans `example/src/lib/admin/` qui emprunte l'ancien chemin des loaders. Il ne valide aucune ligne du code publié.

## Décisions

- Les projets de l'auteur consomment `createAdminHandler` / `AdminHandlerConfig`. Aucun consommateur tiers en 0.2.x n'est à préserver.
- **On nettoie d'abord, on teste ensuite** : pas de test écrit sur du code mort ou non documenté.
- Après nettoyage, la surface publique se réduit à `createAdminHandler`, `AdminHandlerConfig`, `defaultAdminCheck` et les types du parser.
- `handler.ts` est découpé en unités à responsabilité unique avant d'être couvert finement.
- Le découpage est protégé par un filet de tests de caractérisation pris **avant** le refactor.
- Couverture cible : **100 % sur lines, statements, functions et branches**, seuils appliqués en CI.

## Architecture cible

### Supprimé (~2 500 lignes)

| Élément | Raison |
|---|---|
`src/lib/admin.ts` (469 l.) | Orphelin depuis v0.2.0, absent du README |
`src/lib/components/` — `AdminLayout`, `DataTable`, `AdminForm` (1 324 l.) | Orphelins ; `handler.ts` produit du HTML en chaînes et n'utilise aucun composant Svelte |
`src/plugin.ts` (229 l.) | Jamais publié (hors `src/lib`), donc inatteignable |
`src/index.ts` (27 l.) | Idem : `svelte-package` ne package que `src/lib` |
`src/lib/server/crud/` (371 l.) | Redondant avec la logique inline de `handler.ts` |
`createAuthGuard` dans `auth/guard.ts` | Orphelin ; `defaultAdminCheck` est conservé |
Les 3 barrels `index.ts` (`crud`, `auth`, `introspection`) | Réexports de code supprimé |
`example/src/lib/admin/` | Copie vendorée divergente |

`package.json` : retrait des entrées `exports["./components"]` et `exports["./admin"]`.

### Structure finale (~1 300 lignes, Node pur)

```
src/lib/
  index.ts                  # API publique : createAdminHandler, AdminHandlerConfig,
                            # defaultAdminCheck, types du parser
  server/
    handler.ts              # orchestration seule, ~150 l.
    router.ts               # parseRoute
    data.ts                 # coerceId, formDataToPrisma, list/get/create/update/delete
    auth.ts                 # defaultAdminCheck
    introspection/parser.ts # inchangé (261 l.)
    views/
      layout.ts             # baseLayout, adjustColor, escapeHtml, toLabel
      dashboard.ts
      list.ts
      form.ts               # createView, editView, fieldInput, formatValue
      notFound.ts
```

Chaque unité doit être compréhensible sans lire les autres :

- `router.ts` : `(pathname, basePath) → ParsedRoute`. Pure, aucune dépendance.
- `data.ts` : reçoit un client Prisma injecté et un `PrismaModel`. Ne connaît ni HTTP ni HTML.
- `views/*.ts` : `(données) → string`. Pures, aucune dépendance à Prisma ni à `event`.
- `handler.ts` : câble router → data → views. Ne contient aucune règle métier.

### `example/`

Recâblé pour consommer le package publié via `hooks.server.ts` + `createAdminHandler`. Il cesse d'être une copie divergente et devient un smoke test de l'API réelle.

## Stratégie de test

### Outillage

Après suppression des composants, aucun environnement de rendu n'est nécessaire : tout tourne en Node.

- `vitest` (déjà présent). `"test"` passe de `vitest` à `vitest run` ; ajout de `"test:watch": "vitest"`.
- `@vitest/coverage-v8` en devDependency.
- `prisma` + `@prisma/client` en devDependencies, pour les tests d'intégration uniquement.
- Deux *projects* Vitest : `unit` (instantané, aucune I/O) et `integration` (`globalSetup` qui crée puis détruit une base SQLite en fichier temporaire).
- Ni jsdom, ni testing-library.

### Coverage

- Provider `v8`, reporters `text` + `html` + `lcov`.
- `include: src/lib/**` ; `exclude` limité à `src/routes/**` (playground `vite dev`) et `**/*.d.ts`.
- Seuils : **100** pour `lines`, `statements`, `functions`, `branches`.
- Règle : aucun `exclude` de fichier métier. `/* v8 ignore */` autorisé uniquement avec un commentaire justifiant l'inatteignabilité de la branche.
- Limite reconnue : v8 compte des branches issues de la transpilation TypeScript (paramètres par défaut, `??`) ; il subsistera vraisemblablement 2-3 ignores justifiés de ce type. Et 100 % de couverture ne prouve pas la correction du code — seulement qu'aucune ligne n'est jamais exécutée.

### Arborescence des tests

```
tests/
  unit/
    parser.test.ts
    router.test.ts
    data.test.ts
    auth.test.ts
    handler.test.ts                  # orchestration, prisma mocké
    views/
      layout.test.ts  dashboard.test.ts  list.test.ts
      form.test.ts    notFound.test.ts
  characterization/
    handler.snapshot.test.ts
    __snapshots__/
  integration/
    handler.db.test.ts
  fixtures/
    schemas/full.prisma              # tous les types, relations, enums, PK Int + PK String
    schemas/malformed.prisma
    prisma/schema.prisma             # fixture SQLite, sans enum ; client généré gitignoré
    prismaMock.ts                    # fabrique de mock journalisant les appels
    events.ts                        # fabrique de faux RequestEvent (url, request, locals)
```

### Base de test : approche hybride

Un mock de `prisma` vérifie qu'on l'appelle avec la forme d'argument voulue, ce qui reste tautologique : si un `orderBy` ou un `mode: 'insensitive'` est invalide pour le vrai client, le mock ne le dira jamais.

- **Unitaire, sur mocks** : couvre toutes les branches de coercion et d'erreur, y compris celles difficiles à provoquer avec une vraie base (modèle absent du client Prisma, rejet arbitraire d'une requête).
- **Intégration, sur SQLite réel** : une douzaine de cas passant par un vrai `@prisma/client`, qui prouvent que les requêtes générées sont effectivement exécutables.

Contrainte à respecter : **Prisma ne supporte pas les `enum` sur SQLite.** Le fixture d'intégration n'en contient donc pas ; les enums sont couverts uniquement par les tests du parser, qui opèrent sur du texte sans base.

### Inventaire — ~155 cas

| Fichier | Cas | Contenu |
|---|---|---|
`parser.test.ts` | ~45 | `parseSchemaContent` : modèles, docs `///`, enums, drapeaux `isId`/`isUnique`/`isUpdatedAt`/`hasDefault`/`isList`/optionnel, détection `createdAt` par nom **et** par `@default(now())`, relations `name`/`fields`/`references`, scalaire vs enum vs relation, ligne malformée → `null`, `@@index` ignoré, `//` ignoré, schéma vide, modèle sans `@id` → `primaryKey: 'id'`. `parsePrismaSchema` : fichier lu, fichier absent → throw. `getDisplayFields` : filtrage `password`/`hashedPassword`/`hash`/`secret`, `isList`, `relation.fields`. `getEditableFields`. `fieldToLabel` : camelCase, PascalCase, un caractère, déjà espacé. `getInputType` : 9 types + heuristiques `email`/`password`/`url`/`description`/`content`/`bio` + relation |
`router.test.ts` | ~14 | racine avec et sans slash final, slashes multiples, `/model`, `/model/new`, `/model/:id`, 3+ segments, basePath personnalisé et imbriqué, casse préservée, id encodé URL |
`data.test.ts` | ~30 | `coerceId` selon le type de PK (Int, String, String à valeur numérique, cuid, `"007"`) ; `formDataToPrisma` par type (`Int`/`BigInt`/`Float`/`Decimal` vides → `null`, `Boolean` absent → `false`, `'on'`/`'true'`/`'1'`, `DateTime` vide → `null`, `Json` invalide → `null`, champs `isId`/`isCreatedAt`/`isUpdatedAt`/relation ignorés) ; pagination (page 1, page N, page 0, page non numérique, `skip`/`take` calculés) |
`auth.test.ts` | ~8 | `role`, `isAdmin: true`, `roles[]`, `adminRole` personnalisé, `null`, non-objet, objet vide |
`views/*.test.ts` | ~35 | `escapeHtml` (les 4 entités + `'`) ; `adjustColor` (éclaircir, assombrir, bornes 0 et 255, hex invalide) ; `formatValue` (`null`, `undefined`, `DateTime`, `Boolean`, > 50 caractères, échappement) ; `fieldInput` (Boolean coché/décoché, number, `datetime-local` avec et sans valeur, Json, textarea `description`, `readonly`, `required`) ; `notFound` ; `layout` (branding, basePath, modèle courant actif) ; `list` (pagination, table vide) ; `dashboard` (compteurs, total) |
`handler.test.ts` | ~20 | hors `basePath` → `resolve()` appelé ; `authCheck` refuse → 401 ; `authCheck` absent ; GET de chaque vue ; POST `create`/`update`/`delete` → 303 + en-tête `Location` ; POST sur modèle inconnu ; POST sans `_action` ; modèle exclu par `exclude` ; erreur prisma → alerte HTML échappée ; schéma illisible au démarrage → `console.warn` + 0 modèle ; `Content-Type: text/html; charset=utf-8` |
`characterization` | ~15 | snapshots du HTML et des `Response` du handler actuel : dashboard, liste paginée, création, édition, suppression, modèle inconnu, id absent, erreur prisma, auth refusée |
`integration` | ~12 | CRUD réel bout en bout, PK Int **et** PK String, pagination réelle, `findUnique` sans résultat → vue not-found, violation de contrainte unique → alerte, validité effective des `orderBy` générés |

## Défauts identifiés et traitement

Chaque correction est précédée d'un test qui échoue.

### Sécurité — corrigés avant la prise des snapshots

Un filet pris tel quel figerait ces trous ; ils sont donc traités en premier, et les snapshots sont pris sur le comportement corrigé.

1. **XSS réfléchie dans `notFoundView`.** `handler.ts` appelle `notFoundView(\`Model "${route.model}" not found\`)`, où `route.model` provient directement du pathname, et `notFoundView` interpole `${message}` sans échappement. Même chemin pour `${route.id}` dans le message d'édition. Un `GET /admin/<img src=x onerror=…>` exécute du script dans la session admin.
2. **Textarea Json non échappé.** `fieldInput` interpole `JSON.stringify(value, null, 2)` brut ; une valeur en base contenant `</textarea><script>` sort du champ.
3. **Textarea `description`/`content`/`body` non échappé.** Même mécanisme avec `${inputValue}`.

### Comportement — corrigés après le filet, en écarts assumés

Chaque écart met à jour un snapshot, accompagné d'un test dédié.

4. **`coerceId` ignore le type de PK.** `handler.ts` applique `/^\d+$/.test(id) ? parseInt(id) : id` sans consulter le champ `@id` : une PK `String` de valeur `"12345"` est convertie en nombre et le `findUnique` échoue. L'ancien `operations.ts` le faisait correctement (`pkField?.type === 'Int'`) ; la règle correcte est reprise dans `data.ts`.
5. **Sensibilité à la casse incohérente.** `fieldInput` teste `field.name.includes('description')` alors que `getInputType` du parser fait `.toLowerCase().includes(…)`. Un champ `Description` n'obtient pas de textarea. Alignement sur `.toLowerCase()`.
6. **`adjustColor` sur hex invalide.** `parseInt('xyz', 16)` donne `NaN` et produit `#NaNNaN…` dans le CSS. Validation du format, repli sur la couleur par défaut.
7. **`notFoundView` a `href=""`.** Le lien « Back to Dashboard » recharge l'URL courante au lieu de retourner au dashboard. Utilisation de `basePath`.
8. **`parseRoute` avale les URLs profondes.** 3 segments ou plus renvoient silencieusement `{ view: 'dashboard' }`. Renvoi d'une vue not-found à la place.
9. **`escapeHtml` n'échappe pas l'apostrophe.** Non exploitable en l'état — tous les attributs générés utilisent des guillemets doubles — mais fragile dès qu'un template évolue. Ajout de `&#39;`.

### Limitation documentée, non corrigée

Les regex de modèle du parser utilisent `[^}]+` pour le corps : un `@default("{}")` dans un champ interrompt la capture du modèle. Un test documente le comportement sans le corriger — la correction demande un vrai balayage d'accolades, hors périmètre de ce travail.

## Plan d'exécution

| Phase | Contenu | Preuve d'achèvement |
|---|---|---|
0 | Outillage : config Vitest (2 projects), coverage, fixtures de schémas, `prismaMock`, fabrique de faux events | `vitest run` s'exécute à vide sans erreur |
1 | Correctifs sécurité 1-3 en TDD, puis filet de caractérisation (15 snapshots) | 15 snapshots écrits ; 3 tests de non-régression XSS verts |
2 | Nettoyage : suppressions, `package.json`, recâblage `example/` | Snapshots inchangés ; `npm run package` produit un `dist` cohérent |
3 | Découpage `router` / `data` / `views` / `auth`, module par module | Snapshots inchangés à chaque extraction |
4 | Montée à 100 % module par module ; activation des seuils en fin de phase | `vitest run --coverage` : 100/100/100/100 |
5 | Tests d'intégration SQLite | 12 cas verts sur un vrai client Prisma |
6 | Correctifs de comportement 4-8 + CI GitHub Actions (`check`, `lint`, `test --coverage`) | CI verte sur Node 20 et 22 |

## Hors périmètre

- Recherche, tri et `perPage` configurable dans la vue liste (absents aujourd'hui : `perPage` est codé à 20 et l'ordre est fixé sur la PK décroissante). Le parser expose ce qu'il faudrait, mais c'est une fonctionnalité, pas de la couverture.
- Balayage d'accolades correct dans le parser (voir limitation documentée).
- Retour éventuel d'un chemin à base de composants Svelte : si ce besoin réapparaît, ce sera une nouvelle surface, conçue et testée pour elle-même.
