# Audit log des mutations admin (design)

## Contexte

`sveltekit-admin` sait déjà *qui* peut entrer (`authCheck`) et *comment* sortir (`logout`), mais pas *qui a changé quoi*. Toute écriture (create / update / delete) passe par le seul hook `createAdminHandler` dans `handler.ts` : c’est le seul endroit où l’on peut observer une mutation admin de façon fiable, indépendamment de Prisma ou Drizzle.

Le package n’a pas de système de session à lui — `authCheck` et `logout` sont des callbacks fournis par l’app. Il n’a pas non plus de schéma à lui : imposer un modèle `AuditLog` couplerait le package à une table que Prisma et Drizzle devraient tous les deux connaître, et casserait le contrat « zéro fichier / zéro migration imposée ».

## Objectif

Quand un administrateur crée, modifie ou supprime une ligne via l’admin, l’app consommatrice peut enregistrer **qui** a fait **quelle** action sur **quel** enregistrement, avec un résumé des champs changés.

Opt-in, rétrocompatible : sans `audit` dans la config, aucun comportement ne change (pas de lecture extra, pas d’appel, pas de bouton).

## Non-objectifs (cette version)

- Vue admin dédiée aux logs (liste / timeline). Un consommateur qui persiste vers son propre modèle `AuditLog` le voit déjà dans l’admin comme n’importe quel autre modèle.
- Journalisation des lectures (GET), du login, du logout, ou de `_search`.
- Transaction unique « mutation métier + insert du log » : le callback tourne *après* l’écriture réussie, dans le store du consommateur. Un rollback croisé adapter + table d’audit n’est pas possible sans imposer le schéma.
- Diff des relations N-N *avant* écriture (ça coûterait un `getM2mSelectedIds` par arête). On journalise seulement les ids N-N **soumis**.
- Un `getActor` séparé : l’acteur se lit sur `event.locals`, comme `authCheck`.

## Approches écartées

1. **Modèle `AuditLog` first-party** (style Django `LogEntry`) — impose une migration, un nom de table, et une forme Prisma-only ou une introspection spéciale. Incompatible avec l’adapter Drizzle et avec `exclude` / `hidePivotTables`.
2. **Middleware Prisma `$extends` / `.$use`** — invisible pour Drizzle, ne connaît pas `event.locals`, journaliserait aussi les écritures hors admin.
3. **Callback seul, sans snapshots / diffs** — trop pauvre pour « quelle modification » : on saurait l’action et l’id, pas le contenu.

**Retenu** : un callback `audit` optionnel, même philosophie que `logout` / `authCheck`, avec un payload structuré (acteur via `event`, snapshots redactés, `changes` sur update).

## Architecture

```
POST create/update/delete  (après authCheck, après validation FK/m2m)
        │
        ├─ si `audit` configuré et update/delete : getRecord (snapshot `before`)
        ├─ adapter.data.createRecord / updateRecord / deleteRecord
        │     (si ça throw : pas d’audit, le catch existant s’applique)
        └─ await audit(entry)     // best-effort : un throw est loggé, le 303 part quand même
```

Le core `handler.ts` est le seul site d’appel. Prisma et Drizzle n’ont rien à implémenter : `createRecord` / `updateRecord` retournent déjà la ligne, `getRecord` existe déjà.

Aucun `getRecord` supplémentaire quand `audit` est omis — les tests de caractérisation qui comptent les appels Prisma restent stables.

## Surface publique

### Config

```ts
audit?: (entry: AuditEvent) => void | Promise<void>;
```

Sur `AdminHandlerConfig` (core, donc Prisma wrapper **et** entry Drizzle). Absente = no-op, comme `logout` avant d’être configuré.

### Types exportés (type-only, barrel `.` et `sveltekit-admin/adapters/drizzle`)

```ts
export type AuditAction = 'create' | 'update' | 'delete';

export type AuditEvent =
  | {
      event: any;
      at: Date;
      action: 'create';
      model: string;
      id: string | number;
      values: Record<string, unknown>;
      after: Record<string, unknown>;
      m2m?: Record<string, Array<string | number>>;
    }
  | {
      event: any;
      at: Date;
      action: 'update';
      model: string;
      id: string | number;
      values: Record<string, unknown>;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
      changes: Record<string, { from: unknown; to: unknown }>;
      m2m?: Record<string, Array<string | number>>;
    }
  | {
      event: any;
      at: Date;
      action: 'delete';
      model: string;
      id: string | number;
      before: Record<string, unknown> | null;
    };
```

- `event` : le `RequestEvent` SvelteKit, **le même objet** que `authCheck` / `logout`. L’acteur se lit `entry.event.locals.…`.
- `at` : `new Date()` au moment de l’émission (après l’écriture réussie).
- `model` : nom du modèle tel que dans le schéma (`User`, pas `user`).
- `id` : PK de la ligne. Create : PK retournée par `createRecord`. Update/delete : `coerceId(route.id, model)`.
- `values` : payload scalaire **soumis** (après `formDataToPrisma` + validation FK), déjà redacté.
- `before` / `after` : snapshots redactés. `before: null` si `getRecord` a échoué ou n’a rien trouvé — on n’empêche jamais la mutation pour autant.
- `changes` : diff de `before` redacté vs `after` redacté. Objet vide si `before` est `null` (pas de faux « tout est passé de undefined à … »).
- `m2m` : omis s’il n’y a aucune clé dans l’input N-N. Présent (y compris `[]`) si le formulaire a soumis `__rel_present__*`.

## Rédaction (invariants sécu)

`hidden` et `isSensitiveFieldName` doivent fermer **aussi** le chemin audit — un `password` soumis dans le POST create ne doit jamais apparaître dans `values` / `before` / `after` / `changes`. Réutiliser `isSensitiveFieldName` de `parser.ts`, pas une seconde heuristique. Un champ `hidden: ['bio']` est omis des snapshots même s’il n’est pas sensible par nom.

Les champs relation / `isList` sont ignorés (les snapshots `getRecord` n’incluent pas les `include` de relations).

`id` (le champ top-level de `AuditEvent`) n’est **pas** redacté : c’est un identifiant d’audit, pas une colonne affichée.

## Égalité utilisée par `changes`

- `Object.is` d’abord (`NaN` = `NaN`).
- deux `Date` : même `getTime()`.
- deux `bigint` : `===`.
- deux objets / tableaux : `JSON.stringify` (Json Prisma, etc.). Si stringify throw (cycle, bigint déjà écarté), considérés différents.

`after` d’un update est `{ ...before, ...updated }` *avant* rédaction, pour que le mock Prisma (qui retourne seulement `args.data`) et un vrai `update` Prisma (ligne complète) produisent un snapshot comparable. Les clés absentes du retour d’update ne disparaissent pas du snapshot.

## Politique d’erreur

- Mutation qui throw (contrainte unique, delete d’id inexistant, FK invalide) : **pas** d’appel `audit`.
- `audit` qui throw : `console.error('[sveltekit-admin] audit callback failed:', err)`, puis le **303** part quand même. L’écriture métier est la source de vérité ; le log est un sidecar. Documenté. Pas de flag `required` dans cette version.
- `audit` async : `await` avant le 303, pour que `prisma.auditLog.create(...)` soit commité avant la redirection.

Update sans `route.id` (comportement historique : 303 sans écriture) : pas d’audit.
Delete sans `route.id` : pas d’écriture, pas d’audit.
Action `_action` inconnue : pas d’audit.

## Module interne

`src/lib/server/audit.ts` (pas un export runtime du package) :

- `redactForAudit(record, model, hidden) → Record`
- `diffRecords(before, after) → changes`
- `buildAuditEvent(...) → AuditEvent`
- `readAuditSnapshot(getRecord, model, id) → record | null` (catch → `null`)
- `emitAudit(audit, entry)` : no-op si `audit` absent ; await + catch sinon

`handler.ts` ne fait que brancher ces helpers aux trois sites d’écriture.

## Tests

- Unitaires purs : `tests/unit/audit.test.ts` — rédaction (sensible + hidden), diff (Date, bigint, Json, cycle), `emitAudit` no-op / succès / throw / async, `readAuditSnapshot` catch, `buildAuditEvent` pour les trois actions.
- Handler : `tests/unit/handler.audit.test.ts` (miroir de `logout.test.ts`) — create/update/delete appellent `audit` avec le bon discriminant ; `event.locals` est le même objet ; password absent du payload ; pas d’appel si `audit` omis ; pas d’appel si la mutation throw ; throw du callback → 303 + `console.error` ; extra `findUnique` seulement si `audit` est posé ; m2m soumis apparaît sous `m2m.tags` ; update sans id / delete sans id / GET : pas d’audit.
- Intégration SQLite : un describe dans `handler.db.test.ts` avec un handler *dédié* (le handler module-level reste sans `audit`) — create réel expose l’id autoincrement, update calcule `changes.name`, delete porte `before`, unique constraint → pas d’audit.
- `tests/unit/index.test.ts` : ajouter `AuditEvent` et `AuditAction` aux `TYPE_ONLY_EXPORTS`.
- Entry Drizzle : réexporter les deux types ; le test d’isolation ne doit pas se mettre à charger Prisma.

## Docs / changeset

- MINOR (`audit` est une nouvelle option de config).
- Page `docs/src/lib/content/docs/audit-log.svx` + entrée nav Configuration.
- `configuration-reference.svx`, README (section après Logout), `CLAUDE.md` (étape POST + invariant sécu rédaction).
- Exemple d’usage dans les docs : `audit` écrit dans `prisma.auditLog.create`, acteur lu sur `event.locals.session.user`. Pas de changement de schéma dans `example/` (hors scope).

## Hors scope volontaire, à ne pas glisser pendant l’implémentation

- UI / route `/admin/_audit`.
- `audit.models` / allowlist (on peut `if (entry.model === 'AuditLog') return` dans le callback).
- Journaliser un update qui n’écrit pas (update sans id).
- Étendre `DataAdapter`.
