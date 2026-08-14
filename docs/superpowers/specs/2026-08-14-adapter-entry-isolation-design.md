# Isolation des entries ORM (design)

## Contexte

Depuis [db-adapter-abstraction](./2026-08-13-db-adapter-abstraction-design.md) et [l’adapter Drizzle](./2026-08-14-drizzle-adapter-design.md), Prisma et Drizzle sont deux implémentations de `SchemaIntrospector` / `DataAdapter`. Les peers `@prisma/client` et `drizzle-orm` sont déjà optionnelles : un projet Drizzle-only **n’a pas** à installer Prisma.

Le trou restant est le **graphe de modules**, pas npm :

- `createAdminHandler` vit sur l’entry `.` (`src/lib/index.ts`), qui réexporte aussi `createPrismaAdapter`.
- `handler.ts` importe en statique `createPrismaIntrospector`, `createPrismaDataAdapter`, `resolveCaseInsensitiveSearch`.
- En ESM, `import { createAdminHandler } from 'sveltekit-admin'` **évalue tout le barrel**. Le snippet Drizzle documenté charge donc le JS de l’adapter Prisma même sans `@prisma/client`.

`drizzle-orm` est déjà isolé derrière `sveltekit-admin/adapters/drizzle` (l’entry `.` ne l’importe pas). Prisma n’a pas le traitement inverse.

Contraintes héritées, non négociables :

- `vitest.config.ts` : 100 % de couverture sur `src/lib/**`, sans `exclude` ni `v8 ignore`.
- `createAdminHandler({ prisma, prismaSchemaPath })` depuis `sveltekit-admin` : zéro changement observable (characterization, `handler.db.test.ts`, `handler.m2m.db.test.ts` — assertions HTML / DB, pas forcément le chemin d’import de test).
- Le chemin `{ prisma }` **ne passe pas** par `createPrismaAdapter` : celui-ci throw sur un `schemaPath` illisible ; le raccourci dégrade encore en « aucun modèle connu ».
- Pas de raccourci `{ drizzle }` sur le handler core.
- Pas d’`import()` dynamique : `createAdminHandler` reste synchrone (`export const handle = createAdminHandler(...)`).

## Objectif

Une app Drizzle-only peut importer handler + adapter **sans évaluer** `src/lib/server/adapters/prisma/` :

```ts
import {
  createAdminHandler,
  createDrizzleAdapter
} from 'sveltekit-admin/adapters/drizzle';

export const handle = createAdminHandler({
  adapter: createDrizzleAdapter({ db, schema }),
  authCheck: /* ... */
});
```

Prisma ne change pas :

```ts
import { createAdminHandler } from 'sveltekit-admin';

export const handle = createAdminHandler({ prisma });
```

L’ancien snippet Drizzle (handler depuis `.` + adapter depuis le sous-chemin) continue de compiler et d’exécuter. Il charge encore l’adapter Prisma — c’est le chemin non recommandé, pas une casse.

## Architecture

```
sveltekit-admin                         sveltekit-admin/adapters/drizzle
        │                                            │
        ▼                                            ▼
adapters/prisma/handler.ts                  adapters/drizzle/index.ts
  raccourci { prisma }                        réexporte createAdminHandler core
  createPrismaAdapter (via index.ts)          createDrizzleAdapter
        │                                            │
        └────────────► handler.ts ◄──────────────────┘
                       exige `adapter`
                       aucun import adapters/prisma
```

Boot Prisma (raccourci) :

1. Wrapper : si `config.adapter` → core tel quel. Si ni `adapter` ni `prisma` → throw (message actuel). Sinon construit `{ introspector, data }` **sans** `createPrismaAdapter` (dégradation identique sur schéma illisible), applique `config.search.mode` via `resolveCaseInsensitiveSearch`, puis appelle le core.
2. Core : si pas d’`adapter` → throw (`adapter` requis). Introspect synchrone, graphe, requêtes : inchangé.

`caseInsensitiveSearch` n’est plus calculé dans `handler.ts`. Un adapter déjà construit (Drizzle, `createPrismaAdapter`, custom) porte sa propre valeur ; `config.search.mode` ne lui est pas rétro-injecté (déjà le contrat Drizzle).

## Composants

### `handler.ts` (core)

- `AdminHandlerConfig` : `adapter` **requis**. Plus de `prisma`, `prismaSchemaPath`, `search.mode`.
- Le reste de la config (models, auth, branding, `listWhere`, …) ne bouge pas.
- Throw si `adapter` absent : message distinct du wrapper, centré sur `adapter` (pas « prisma or adapter »).
- Zéro import de `adapters/prisma/**`.

### `adapters/prisma/handler.ts` (nouveau)

Wrapper publié par l’entry `.`. Même nom exporté : `createAdminHandler`.

`AdminHandlerConfig` Prisma = config core moins `adapter` requis, plus :

- `prisma?: any`
- `prismaSchemaPath?: string` (défaut toujours `'./prisma/schema.prisma'`)
- `adapter?` (prioritaire sur `prisma` si les deux sont passés)
- `search?: { mode?: 'auto' | 'insensitive' | 'default' }`

Ne pas réexporter ce wrapper depuis `adapters/prisma/index.ts` : `createPrismaAdapter` ne doit pas tirer le handler + les vues.

### Entry `.` (`src/lib/index.ts`)

- `createAdminHandler` / `AdminHandlerConfig` ← `adapters/prisma/handler.ts` (plus `handler.ts`).
- Inchangé : `defaultAdminCheck`, `parsePrismaSchema`, `parseSchemaContent`, types `Prisma*`, `createPrismaAdapter`, types génériques.
- `RUNTIME_EXPORTS` de `tests/unit/index.test.ts` : **inchangé**.

### `sveltekit-admin/adapters/drizzle`

Réexporte depuis le core / `auth.ts`, sans passer par `.` ni `adapters/prisma/` :

- `createAdminHandler`, `AdminHandlerConfig` (forme core : `adapter` requis)
- `defaultAdminCheck` (sinon un consommateur Drizzle qui l’importe depuis `.` ré-évalue le barrel Prisma)
- `createDrizzleAdapter`, `DrizzleDialect` (déjà là)
- types génériques déjà publics : `Schema`, `Model`, `Field`, `DataAdapter`, `SchemaIntrospector`, `Filter` (type-only)

Pas de `parsePrismaSchema` / `createPrismaAdapter` sur ce sous-chemin.

Pas de nouvel export `./core` ni `./adapters/prisma` dans `package.json`. Le sous-chemin Drizzle importera `handler.ts` (vues incluses) : c’est voulu — un consommateur Drizzle n’importe plus `.`. Le chunk Drizzle grandit du handler, pas de l’adapter Prisma.

### Tests

- Tous les tests Prisma qui font `createAdminHandler({ prisma })` importent le wrapper `adapters/prisma/handler.ts` (le factory que `.` réexporte), **pas** `handler.ts`. `tests/unit/index.test.ts` reste le pin du barrel publié. Liste à rebrancher : characterization, `handler.db.test.ts`, `handler.m2m.db.test.ts`, et les unitaires handler/list/search/fk/logout/security/m2m.
- `handler.test.ts` : le cas « ni prisma ni adapter » et le boot `{ prisma }` (schéma illisible, défaut `prismaSchemaPath`) déménagent vers `tests/unit/adapters/prisma/handler.test.ts`. Le core teste « `adapter` manquant → throw » avec le message `[sveltekit-admin] createAdminHandler requires \`adapter\`.` Le wrapper **conserve** le message actuel (`requires either \`prisma\` … or \`adapter\``).
- `handler.drizzle.db.test.ts` importe `createAdminHandler` depuis `adapters/drizzle/index.ts` (le chemin publié), **pas** depuis `handler.ts`.
- Test d’isolation : importer `adapters/drizzle/index.js` **réussit** alors que `adapters/prisma/index.js` et `adapters/prisma/handler.ts` sont mockés pour throw au chargement. Ça verrouille le graphe, pas seulement la liste d’exports.
- Surface Drizzle : `createAdminHandler`, `defaultAdminCheck`, `createDrizzleAdapter` sont des fonctions ; `createPrismaAdapter` n’y figure pas.

Assertions characterization / intégration Prisma : **zéro diff**. Seul le module d’import du factory change.

### Docs / changeset

- README : snippet Drizzle = un seul import depuis `sveltekit-admin/adapters/drizzle`. Mentionner que l’import du handler depuis `.` marche encore mais charge l’adapter Prisma.
- Changeset **minor** : nouveau contrat d’import Drizzle (réexports), Prisma inchangé. Pas major : l’ancien import compile toujours.

## Sécurité

Aucun invariant IDOR / scope / filter n’est rouvert : le core ne change pas sa pipeline requête. Le wrapper ne fait que construire `{ introspector, data }` avant d’appeler le même core.

## Compatibilité API publique

```ts
// Prisma — inchangé
import { createAdminHandler } from 'sveltekit-admin';
createAdminHandler({ prisma, prismaSchemaPath: './prisma/schema.prisma' });

// Drizzle — recommandé (nouveau)
import { createAdminHandler, createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
createAdminHandler({ adapter: createDrizzleAdapter({ db, schema }) });

// Drizzle — ancien snippet, toujours valide, graphe Prisma chargé
import { createAdminHandler } from 'sveltekit-admin';
import { createDrizzleAdapter } from 'sveltekit-admin/adapters/drizzle';
```

- Types `AdminHandlerConfig` : deux formes selon l’entry (Prisma vs core). L’entry `.` garde `prisma?` / `prismaSchemaPath?` / `search.mode`.
- `createPrismaAdapter` reste sur `.` uniquement.

## Hors périmètre

- Export public `./core` ou `./adapters/prisma`.
- Raccourci `createAdminHandler({ drizzle, schema })`.
- `import()` dynamique / `createAdminHandler` async.
- Unifier le boot `{ prisma }` avec `createPrismaAdapter` (perdrait la dégradation silencieuse).
- Rename `formDataToPrisma` / `toPrismaModel` / alias `PrismaModel` dans le core.
- Retirer `@prisma/client` de `peerDependencies` (déjà `optional: true`).
- Site `docs/` et app `example/`.
- Kysely / tout autre ORM.
