# Erreurs de mutation exploitables (design)

## Contexte

Toute erreur levée pendant une mutation admin aboutit aujourd'hui dans un unique `catch` de `handler.ts` :

```ts
} catch (e: any) {
  console.error('[sveltekit-admin] Error:', e);
  content = `<div class="ska-alert ska-alert--error">Error: ${escapeHtml(e.message || 'Unknown error')}</div>`;
}
```

Trois défauts, dans le même geste :

1. **Le formulaire disparaît.** `content` est écrasé, donc la saisie de l'utilisateur est perdue. Sur un formulaire à quinze champs, une contrainte violée oblige à tout retaper.
2. **Le message du moteur part au navigateur.** Un `P2002` Prisma affiche ``Invalid `prisma.user.create()` invocation … Unique constraint failed on the fields: (`email`)``, texte de requête compris. C'est une fuite d'internes DB en clair, et c'est ce que le point P0 « Avoid leaking internal DB details » désigne.
3. **Rien n'est actionnable.** Ni le champ fautif, ni ce qu'il faut corriger.

Deux atouts existent déjà et changent la forme de la solution :

- **`mutations.ts` lève déjà des messages propres et cadrés par champ** (`` `${edge.field} is required` ``, `` `${edge.field}: invalid value` ``, `` `${edge.field}: cannot reference itself` ``, `` `${field}: value is outside the authorization scope` ``). Ils ne fuient rien ; ils sont seulement rendus au mauvais endroit.
- **`retry.ts` a déjà le patron de classification par code**, avec un `codeOf` qui gère le fait que `pg`, `mysql2` et Prisma rangent le code SQLSTATE à trois endroits différents.

Dette adjacente à solder au passage : `mutations.ts` reconnaît ses propres erreurs par reniflage de chaîne (`e?.message?.includes('invalid value')`) sur **quatre** sites. Une erreur typée supprime ce couplage au texte.

## Objectif

Une mutation qui échoue doit :

- réafficher le formulaire **avec la saisie de l'utilisateur**, l'erreur rattachée au champ concerné ;
- expliquer les conflits d'unicité et de clé étrangère en des termes actionnables ;
- ne **jamais** rendre un texte que la bibliothèque n'a pas construit elle-même.

Parité stricte Prisma / Drizzle sur les trois points (règle 4 de l'issue #25).

## Hors périmètre

- Validation côté client, et tout framework de validation (zod & co).
- Localisation : messages en anglais, comme le reste de l'UI.
- Erreurs de suppression en masse — le bulk delete est un point P1, pas encore construit.
- Refonte de la sémantique des refus de scope au-delà du strict nécessaire au rendu.
- Contraintes `@@unique` composites nommées champ par champ : elles dégradent sur le message modèle (voir « Sonde »).

## Approches écartées

1. **Parser le message du pilote par dialecte** pour extraire le champ (regex sur SQLite/MySQL, mapping du nom de contrainte PG vers ses colonnes). Trois formats fragiles aux versions de pilote et aux conventions de nommage, trois fois plus de code que la solution retenue, et le gate 100 % exige un test par branche.
2. **Se contenter du `meta.target` de Prisma**, sans équivalent Drizzle. Deux défauts. D'abord une asymétrie assumée entre adapters, que la règle 4 interdit. Ensuite et surtout : `meta.target` est **aveugle au scope**. Tenant A soumet `email: bob@tenantB.com`, la contrainte d'unicité est globale, Prisma répond `['email']` — à propos d'une ligne que A n'a pas le droit de voir. La contrainte est déjà un oracle par elle-même (A peut inférer la même chose en faisant varier la valeur), donc nommer le champ ne *crée* pas la fuite ; ça la fait passer d'inférable à énoncée. Ce n'est pas un trou à colmater, c'est le signe que la source d'information est la mauvaise.
3. **Un SELECT de vérification avant chaque écriture.** Identifie le champ sans jamais toucher à une erreur pilote, identique sur les deux adapters — mais coûte une requête sur *chaque* écriture, ouvre une fenêtre TOCTOU, et oblige à garder le traitement d'erreur en filet malgré tout. Deux chemins au lieu d'un.

**Retenu** : le pilote donne le **type**, le schéma donne les **candidats**, une sonde scopée sur le chemin d'erreur donne le **champ**.

## Architecture

```
POST create/update/delete
   │
   ├─ mutations.ts : validation FK/m2m/scope
   │     └─ échec → throw AdminMutationError({ kind: 'validation' | 'authorization', field })
   │
   ├─ adapter.data.createRecord / updateRecord / deleteRecord
   │     └─ échec pilote → classifyWriteError(e, action) → AdminMutationError | null
   │
   └─ handler.ts catch
         ├─ AdminMutationError → enrichissement (sonde / compteurs) → re-render du Form
         └─ tout le reste       → console.error + message générique, message d'origine JAMAIS rendu
```

Le type est déterminé par code, jamais par texte :

| Type | Prisma | PostgreSQL | MySQL | SQLite |
|---|---|---|---|---|
| `conflict` (unicité) | `P2002` | `23505` | `ER_DUP_ENTRY` | `SQLITE_CONSTRAINT_UNIQUE` |
| `reference` / `restrict` (FK) | `P2003` | `23503` | `ER_NO_REFERENCED_ROW_2`, `ER_ROW_IS_REFERENCED_2` | `SQLITE_CONSTRAINT_FOREIGNKEY` |
| `notFound` | `P2025` | — | — | — |

`reference` et `restrict` partagent le même code SQLSTATE côté PostgreSQL. On les distingue par **l'action en cours**, que le handler connaît déjà : `create`/`update` → une cible soumise est invalide ; `delete` → la ligne est référencée ailleurs. Aucun parsing.

## Composants

### `src/lib/server/errors.ts` (nouveau)

```ts
export type MutationErrorKind =
  | 'validation'     // champ invalide, message construit par la lib
  | 'conflict'       // unicité violée
  | 'reference'      // cible FK soumise invalide
  | 'restrict'       // suppression bloquée par des lignes référençantes
  | 'authorization'  // hors scope
  | 'unknown';       // tout le reste → message générique

export class AdminMutationError extends Error {
  kind: MutationErrorKind;
  field?: string;
}

export function classifyWriteError(
  error: unknown,
  action: 'create' | 'update' | 'delete'
): AdminMutationError | null;
```

`codeOf` migre de `retry.ts` vers ce module ; `retry.ts` l'importe. Même helper, un seul exemplaire — c'est la règle du prédicat partagé que le repo applique déjà à `isSensitiveFieldName`.

### `mutations.ts`

Les quatorze `throw new Error(...)` (six messages distincts) deviennent des `AdminMutationError` avec `kind` et `field`. Les quatre `includes('invalid value')` disparaissent au profit d'un test de type.

Les messages actuels sont conservés au mot près : ils sont déjà corrects, et les tests existants s'appuient dessus.

### `handler.ts`

**Le `catch` partagé n'est PAS le bon point d'accroche.** Il couvre aussi le rendu GET et les pages de plugin : un plugin dont le `render()` lève voit son message rendu (`handler.plugins.test.ts:123`), et une lecture de liste qui échoue affiche `Unknown error` (`handler.test.ts:465`). Y toucher élargirait le changement bien au-delà du point de roadmap, et changerait silencieusement le contrat des plugins.

Les erreurs de mutation sont donc interceptées **au site d'appel de `handleMutation`**, dans son propre `try`. Le `catch` partagé garde son comportement actuel à l'identique.

Ce `try` produit un `MutationFailure` (`{ kind, field?, message }`) et laisse la vue GET se rendre normalement — chemin déjà existant, y compris `loadRelationOptions` et `loadRelatedCounts`.

### `Form.svelte`

Deux props nouvelles :

- `submitted?: Record<string, string | string[]>` — le **FormData brut**, pas le payload de `formDataToPrisma`. Si l'utilisateur tape `abc` dans un Int, le payload coercé vaut `null` ; réafficher ça effacerait sa saisie et masquerait l'erreur.
- `fieldErrors?: Map<string, string>` — l'erreur rattachée à son champ, plus un emplacement pour l'erreur au niveau formulaire.

Le mécanisme de pré-remplissage existe déjà : la vue `create` passe un `item: itemPrefill` partiel pour le pré-remplissage FK depuis la query string. `submitted` réutilise ce chemin de rendu au lieu d'en ouvrir un second.

Pour les N-N, `RelationMeta.selectedIds` est alimenté depuis les `__rel__<field>` soumis plutôt que depuis la base.

### Sonde du champ en conflit

Sur `kind: 'conflict'` uniquement, donc jamais sur le chemin heureux :

1. candidats = champs `isUnique` du modèle (déjà portés par `Schema.Field`, zéro requête) ;
2. pour chacun, `findFirst` **scopé** contre la valeur soumise ;
3. le premier qui matche nomme le champ ; aucun ne matche → message au niveau modèle.

Pas de TOCTOU qui compte : la décision d'autorisation est déjà prise par le moteur, la sonde ne produit qu'un *message*. Si elle court après une ligne supprimée entre-temps, on retombe sur le message générique — un message imprécis est cosmétique, pas une faille. Modèle sans champ `isUnique` hors PK : la sonde est sautée entièrement.

### Suppression bloquée

Sur `kind: 'restrict'`, aucun contrat adapter nouveau. `relationGraph` connaît les relations inverses et `loadRelatedCounts` calcule déjà ces compteurs, scopés, pour le formulaire d'édition. On le rappelle et on liste les non-zéro :

> Cannot delete: 3 Post, 1 Comment reference this record.

C'est le plus gros gain du lot pour le coût le plus faible — et l'erreur la plus fréquente d'un back-office.

## Sécurité (invariants à ne pas réouvrir)

- **Seuls des messages construits par la bibliothèque sont rendus.** Un `kind: 'unknown'` journalise via le `console.error` existant et affiche un texte fixe. `e.message` sort définitivement du HTML.
- **La sonde est scopée** par `modelScopeFrom`, comme toute lecture. C'est ce qui fait que le cas tenant A / tenant B ci-dessus retombe sur le message modèle sans nommer le champ.
- **Un champ matché par `isSensitiveFieldName` ou listé dans `hidden` n'est jamais repeuplé, et jamais nommé** dans un message. Réutilise le prédicat partagé — pas de seconde heuristique, c'est la classe de bug que ce repo a déjà corrigée une fois.
- `loadRelatedCounts` est déjà scopé : les compteurs de suppression ne comptent pas les lignes d'un autre tenant.
- Le rendu d'erreur passe de `200` à **`422`**. Changement de comportement observable, à porter dans le changeset.

## Tests

Par PR, sur `tests/unit/` avec le mock existant, plus les tests DB pour les codes réels des pilotes.

- **Classification** : un cas par code du tableau, sur les deux adapters ; un code inconnu retombe sur `unknown`.
- **Non-fuite** : une erreur pilote arbitraire ne fait apparaître ni son message, ni un nom de table, ni un fragment de requête dans le HTML rendu.
- **Non-régression du chemin partagé** : les erreurs de plugin et de lecture GET rendent exactement comme avant. Les ~25 assertions existantes sur les messages de `mutations.ts` (`toContain('author: invalid value')` et consorts, dans `fkEditable`, `m2mImplicit`, `handler.drizzle.db`) doivent passer sans être touchées — c'est la preuve que les messages sont conservés au mot près.
- **Préservation** : après échec, chaque champ soumis est réaffiché ; un champ sensible ne l'est pas ; les cases N-N cochées le restent.
- **Sonde** : champ nommé quand il est en scope ; message modèle quand la ligne en conflit est hors scope (le test anti-oracle) ; message modèle sur contrainte composite.
- **Suppression** : compteurs corrects, et un référençant hors scope n'est pas compté.

Gate 100 % sur les quatre métriques, sans `exclude` ni `v8 ignore`.

`tests/characterization/handler.snapshot.test.ts` capture `status` **et** `body`. Le passage à `422` et la disparition du message moteur du HTML cassent ces snapshots **volontairement** : ils doivent être relus ligne à ligne et régénérés dans la PR qui les change, jamais régénérés en bloc pour faire passer la CI.

## Découpage en PRs

| PR | Contenu | Livrable seul |
|---|---|---|
| 1 | `errors.ts`, classification, `AdminMutationError` dans `mutations.ts`, fallback générique, `e.message` retiré du rendu | Oui — ferme la fuite, qui est le vrai P0 |
| 2 | Réaffichage du formulaire : `submitted`, `fieldErrors`, `422` | Oui — l'UX |
| 3 | Messages riches : sonde d'unicité, suppression bloquée via `loadRelatedCounts` | Oui — le confort |

Si seuls 1 et 2 étaient livrés, le point de roadmap serait substantiellement clos.

## Docs / changeset

- Un changeset par PR, en **patch** pour les trois. Le skill `writing-changesets` tranche explicitement ce cas : sans nouvel export ni nouvelle option de config, affiner ce qui existe déjà est un patch, et il nomme les *messages d'erreur* parmi ses exemples. Aucune des trois PRs n'ajoute de levier au consommateur — `AdminMutationError` reste interne. Si on décidait de l'exporter (pour qu'un plugin ou un `audit` puisse le discriminer), cette PR-là passerait en **minor** ; ce n'est pas prévu ici.
- Page docs sur le comportement d'erreur, et mention dans la référence de configuration que les messages moteur ne sont jamais exposés.
