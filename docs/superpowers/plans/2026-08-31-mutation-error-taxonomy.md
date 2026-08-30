# Taxonomie d'erreurs de mutation (PR 1/3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aucune erreur de mutation ne rend un texte que la bibliothèque n'a pas construit elle-même, et `mutations.ts` cesse de reconnaître ses propres erreurs par reniflage de chaîne.

**Architecture:** Un module `errors.ts` porte une classe `AdminMutationError` (`kind` + `field`) et un `classifyWriteError` qui traduit un code pilote en `kind`. `mutations.ts` lève cette classe au lieu de `Error`. Le site d'appel de `handleMutation` dans `handler.ts` gagne son propre `try` : une `AdminMutationError` rend son message, tout le reste rend un texte générique fixe. Le `catch` partagé de `handler.ts` n'est pas touché.

**Tech Stack:** TypeScript, Vitest, Svelte 5 (`render` de `svelte/server`), adapters Prisma et Drizzle.

**Spec:** `docs/superpowers/specs/2026-08-30-actionable-mutation-errors-design.md`

## Global Constraints

- Gate de couverture **100 % sur les 4 métriques** (lines/statements/functions/branches) sur `src/lib/**`. Pas d'`exclude`, pas de `/* v8 ignore */`. Ne pas écrire de branche défensive intestable.
- **Les messages actuels de `mutations.ts` sont conservés au mot près.** ~25 assertions existantes en dépendent (`fkEditable.test.ts`, `m2mImplicit.test.ts`, `handler.drizzle.db.test.ts`). Aucune ne doit être modifiée.
- **Le `catch` partagé de `handler.ts` (actuellement ~ligne 542) n'est pas modifié dans cette PR.** Il couvre aussi le rendu GET et les pages de plugin ; y toucher casserait `handler.plugins.test.ts:123` et `handler.test.ts:465`, hors périmètre.
- Commentaires de code en **français** dans `src/lib/server/**` (convention du repo pour ces modules). Messages d'interface en **anglais**.
- Pas de nouvel export public : `AdminMutationError` reste interne, ce qui fixe le changeset en **patch**.
- Commandes : `pnpm exec vitest run <fichier>` pour un fichier, `pnpm run test` pour la suite, `pnpm run test:coverage` pour le gate.

---

### Task 1 : le module `errors.ts`

**Files:**
- Create: `src/lib/server/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `MutationErrorKind`, `AdminMutationError`, `codeOf(error: unknown): string | undefined`, `classifyWriteError(error: unknown, action: 'create' | 'update' | 'delete'): AdminMutationError | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/errors.test.ts
import { describe, it, expect } from 'vitest';
import { AdminMutationError, classifyWriteError, codeOf } from '../../src/lib/server/errors.js';

describe('codeOf', () => {
  it('lit `code` à la racine (pg, mysql2, better-sqlite3)', () => {
    expect(codeOf({ code: '23505' })).toBe('23505');
  });

  it('lit `meta.code` (PrismaClientKnownRequestError en transaction)', () => {
    expect(codeOf({ meta: { code: '40001' } })).toBe('40001');
  });

  it('renvoie undefined sur une erreur sans code exploitable', () => {
    expect(codeOf(new Error('boom'))).toBeUndefined();
    expect(codeOf(null)).toBeUndefined();
    expect(codeOf({ code: 42 })).toBeUndefined();
  });
});

describe('classifyWriteError', () => {
  it('classe une violation d’unicité sur les quatre moteurs', () => {
    for (const code of ['P2002', '23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE']) {
      expect(classifyWriteError({ code }, 'create')?.kind).toBe('conflict');
    }
  });

  it('classe une violation de FK en `reference` sur create/update', () => {
    expect(classifyWriteError({ code: '23503' }, 'create')?.kind).toBe('reference');
    expect(classifyWriteError({ code: 'P2003' }, 'update')?.kind).toBe('reference');
  });

  it('classe la même violation de FK en `restrict` sur delete', () => {
    expect(classifyWriteError({ code: '23503' }, 'delete')?.kind).toBe('restrict');
    expect(classifyWriteError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }, 'delete')?.kind).toBe(
      'restrict'
    );
  });

  it('classe une ligne absente en `notFound`', () => {
    expect(classifyWriteError({ code: 'P2025' }, 'update')?.kind).toBe('notFound');
  });

  it('renvoie null sur un code inconnu — l’appelant décidera du générique', () => {
    expect(classifyWriteError({ code: 'ER_SOMETHING_ELSE' }, 'create')).toBeNull();
    expect(classifyWriteError(new Error('connexion perdue'), 'create')).toBeNull();
  });

  it('laisse passer une AdminMutationError déjà typée sans la reclasser', () => {
    const original = new AdminMutationError('conflict', 'email: already used', 'email');
    expect(classifyWriteError(original, 'create')).toBe(original);
  });
});

describe('AdminMutationError', () => {
  it('porte kind, field et message, et reste une Error', () => {
    const e = new AdminMutationError('validation', 'author: invalid value', 'author');
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('validation');
    expect(e.field).toBe('author');
    expect(e.message).toBe('author: invalid value');
  });

  it('accepte l’absence de champ', () => {
    expect(new AdminMutationError('unknown', 'boom').field).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/errors.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/server/errors.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/errors.ts
/**
 * Forme unique des échecs de mutation admin.
 *
 * Deux producteurs, un seul type : `mutations.ts` pour les refus que la
 * bibliothèque décide elle-même (validation, scope), `classifyWriteError`
 * pour ceux que le moteur signale. Un seul consommateur : le site d'appel
 * de `handleMutation` dans `handler.ts`, qui ne rend QUE le message d'une
 * `AdminMutationError` — jamais celui d'une erreur pilote brute.
 *
 * La classification se fait par code, jamais par texte : les messages des
 * pilotes changent entre versions, les codes non.
 */

export type MutationErrorKind =
  | 'validation'
  | 'conflict'
  | 'reference'
  | 'restrict'
  | 'authorization'
  | 'notFound'
  | 'unknown';

export class AdminMutationError extends Error {
  readonly kind: MutationErrorKind;
  readonly field?: string;

  constructor(kind: MutationErrorKind, message: string, field?: string) {
    super(message);
    this.name = 'AdminMutationError';
    this.kind = kind;
    this.field = field;
  }
}

/**
 * Les pilotes exposent le code SQLSTATE à des endroits différents : `code` sur
 * `pg`, `mysql2` et `better-sqlite3`, `meta.code` sur une
 * `PrismaClientKnownRequestError` issue d'une transaction interactive.
 *
 * Vit ici plutôt que dans `retry.ts` : deux modules classent désormais les
 * erreurs pilote, et un second exemplaire de ce helper dériverait du premier.
 */
export function codeOf(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; meta?: { code?: unknown } } | null;
  const raw = candidate?.code ?? candidate?.meta?.code;
  return typeof raw === 'string' ? raw : undefined;
}

const UNIQUE_CODES = new Set([
  'P2002', // Prisma
  '23505', // PostgreSQL — unique_violation
  'ER_DUP_ENTRY', // MySQL 1062
  'SQLITE_CONSTRAINT_UNIQUE'
]);

const FOREIGN_KEY_CODES = new Set([
  'P2003', // Prisma
  '23503', // PostgreSQL — foreign_key_violation
  'ER_NO_REFERENCED_ROW_2', // MySQL 1452 — la cible soumise n'existe pas
  'ER_ROW_IS_REFERENCED_2', // MySQL 1451 — la ligne est référencée ailleurs
  'SQLITE_CONSTRAINT_FOREIGNKEY'
]);

const NOT_FOUND_CODES = new Set(['P2025']);

/**
 * Traduit un échec d'écriture en `AdminMutationError`, ou `null` si le code
 * n'est pas reconnu — l'appelant rend alors un message générique.
 *
 * `reference` et `restrict` partagent le même code SQLSTATE (PostgreSQL 23503,
 * SQLite SQLITE_CONSTRAINT_FOREIGNKEY) : c'est l'action en cours qui les
 * sépare, pas le message. Sur create/update une cible soumise est invalide ;
 * sur delete la ligne est référencée ailleurs.
 */
export function classifyWriteError(
  error: unknown,
  action: 'create' | 'update' | 'delete'
): AdminMutationError | null {
  if (error instanceof AdminMutationError) return error;

  const code = codeOf(error);
  if (code === undefined) return null;

  if (UNIQUE_CODES.has(code)) {
    return new AdminMutationError('conflict', 'A record with these values already exists.');
  }
  if (FOREIGN_KEY_CODES.has(code)) {
    return action === 'delete'
      ? new AdminMutationError('restrict', 'This record is referenced by other records.')
      : new AdminMutationError('reference', 'A referenced record no longer exists.');
  }
  if (NOT_FOUND_CODES.has(code)) {
    return new AdminMutationError('notFound', 'This record no longer exists.');
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/errors.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/errors.ts tests/unit/errors.test.ts
git commit -m "feat: classify write errors by driver code"
```

---

### Task 2 : `retry.ts` réutilise `codeOf`

**Files:**
- Modify: `src/lib/server/adapters/retry.ts:31-40` (le `codeOf` local et son commentaire)
- Test: `tests/unit/adapters/retry.test.ts` (inchangé — c'est le point)

**Interfaces:**
- Consumes: `codeOf` de Task 1.
- Produces: rien de nouveau. `isRetryableWriteError` et `withWriteRetry` gardent leur signature.

Refactor pur, sans changement de comportement : la suite existante de `retry.test.ts` est le test. Aucun test nouveau, aucun test modifié.

- [ ] **Step 1: Vérifier le point de départ vert**

Run: `pnpm exec vitest run tests/unit/adapters/retry.test.ts`
Expected: PASS. Si ça échoue déjà, arrêter et le signaler — le refactor n'est pas la cause.

- [ ] **Step 2: Supprimer le `codeOf` local et importer celui de `errors.ts`**

Retirer intégralement de `src/lib/server/adapters/retry.ts` le bloc de commentaire `/** Les pilotes exposent le code SQLSTATE... */` et la fonction `codeOf` qui le suit, puis ajouter en tête du fichier, sous les autres imports :

```ts
import { codeOf } from '../errors.js';
```

Ne rien changer d'autre : `RETRYABLE_CODES`, `isRetryableWriteError` et `withWriteRetry` restent tels quels.

- [ ] **Step 3: Vérifier que rien n'a bougé**

Run: `pnpm exec vitest run tests/unit/adapters/retry.test.ts`
Expected: PASS, exactement les mêmes tests qu'au Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/adapters/retry.ts
git commit -m "refactor: share codeOf between retry and error classification"
```

---

### Task 3 : `mutations.ts` lève des erreurs typées

**Files:**
- Modify: `src/lib/server/mutations.ts` (14 `throw new Error`, 6 messages distincts ; 4 sites de `includes('invalid value')`)
- Test: `tests/unit/mutationErrors.test.ts`

**Interfaces:**
- Consumes: `AdminMutationError` de Task 1.
- Produces: `handleMutation` lève désormais des `AdminMutationError` au lieu d'`Error`. Signature inchangée.

Le message de chaque throw est **repris caractère pour caractère**. Seule la classe change, plus l'ajout de `kind`/`field`.

Correspondance à appliquer :

| Message actuel | `kind` | `field` |
|---|---|---|
| `` `${edge.field} is required` `` | `validation` | `edge.field` |
| `` `${edge.field}: invalid id` `` | `validation` | `edge.field` |
| `` `${edge.field}: cannot reference itself` `` | `validation` | `edge.field` |
| `` `${edge.field}: invalid value` `` | `validation` | `edge.field` |
| `` `${field}: value is outside the authorization scope` `` | `authorization` | `field` |
| `` `Model "${route.model}" not found` `` | `notFound` | — |

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mutationErrors.test.ts
import { describe, it, expect } from 'vitest';
import { createAdminHandler } from '../../src/lib/server/adapters/prisma/handler.js';
import { createPrismaMock, RELATIONS_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { AdminMutationError } from '../../src/lib/server/errors.js';
import { handleMutation } from '../../src/lib/server/mutations.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createEvent } from '../fixtures/events.js';

function runtimeFor(prisma: any, config: Record<string, unknown> = {}) {
  const adapter = createPrismaAdapter({ prisma, schemaPath: RELATIONS_SCHEMA_PATH });
  return createAdminRuntime({ adapter, ...config } as any);
}

describe('handleMutation lève des AdminMutationError', () => {
  it('une FK inexistante donne kind=validation et le champ, message inchangé', async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [] });
    const runtime = runtimeFor(prisma);
    const { event } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '999' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any)
    ).rejects.toMatchObject({
      constructor: AdminMutationError,
      kind: 'validation',
      field: 'author',
      message: 'author: invalid value'
    });
  });

  it('un modèle inconnu donne kind=notFound, message inchangé', async () => {
    const prisma = createPrismaMock({ user: [] });
    const runtime = runtimeFor(prisma);
    const { event } = createEvent({ url: '/admin/nope/new', body: { _action: 'create' } });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'nope' } as any)
    ).rejects.toMatchObject({
      kind: 'notFound',
      message: 'Model "nope" not found'
    });
  });

  it('une valeur hors scope donne kind=authorization et le champ de scope', async () => {
    // L'utilisateur 2 DOIT exister : la boucle de validation FK tourne avant
    // l'imposition du scope, et rejetterait sinon la valeur en `validation`
    // — on ne testerait plus la branche visée.
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }], post: [], tag: [] });
    const runtime = runtimeFor(prisma, {
      models: { Post: { scope: () => ({ authorId: 1 }) } }
    });
    const { event } = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '2' }
    });

    await expect(
      handleMutation(runtime, event, { view: 'create', model: 'post' } as any)
    ).rejects.toMatchObject({ kind: 'authorization', field: 'authorId' });
  });
});
```

> `tests/fixtures/schemas/relations.prisma` déclare `Post.authorId Int` (requis) et la relation `Post.author`, d'où le `field: 'author'` attendu : c'est le nom de l'arête de relation que porte l'erreur, pas celui du scalaire. `Post.id` est un `String @default(cuid())`, donc aucun id numérique à forger côté Post.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/mutationErrors.test.ts`
Expected: FAIL — les erreurs levées sont des `Error` nues, `kind` et `field` sont `undefined`.

- [ ] **Step 3: Write minimal implementation**

Dans `src/lib/server/mutations.ts` :

a. Ajouter l'import :

```ts
import { AdminMutationError } from './errors.js';
```

b. Remplacer chaque `throw new Error(...)` selon le tableau ci-dessus. Exemples :

```ts
// avant : throw new Error(`${edge.field} is required`);
throw new AdminMutationError('validation', `${edge.field} is required`, edge.field);

// avant : throw new Error(`${edge.field}: invalid value`);
throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);

// avant : throw new Error(`Model "${route.model}" not found`);
throw new AdminMutationError('notFound', `Model "${route.model}" not found`);

// avant : throw new Error(`${field}: value is outside the authorization scope`);
throw new AdminMutationError(
  'authorization',
  `${field}: value is outside the authorization scope`,
  field
);
```

c. Remplacer les quatre blocs de reniflage de chaîne. Ils ont tous cette forme :

```ts
} catch (e: any) {
  if (e?.message?.includes('invalid value')) throw e;
  if (
    e?.message &&
    (e.message.includes(OPAQUE_FILTER_ERROR) ||
      OPAQUE_FILTER_ERROR.startsWith(e.message))
  ) {
    throw new Error(`${edge.field}: invalid value`);
  }
  if (e?.message?.includes('unknown field')) {
    throw new Error(`${edge.field}: invalid value`);
  }
  throw new Error(`${edge.field}: invalid value`);
}
```

Toutes les branches produisent le même message : le seul rôle réel du bloc est de ne pas ré-emballer une erreur déjà émise par le `if (!found)` juste au-dessus. Un test de type le dit directement :

```ts
} catch (e: any) {
  // Déjà typée par le `if (!found)` ci-dessus : la relayer telle quelle.
  // Toute autre cause (scope incompilable, champ inconnu, panne pilote)
  // devient le même refus : la valeur soumise n'est pas acceptable, et on
  // ne renvoie jamais au client ce que le pilote a dit.
  if (e instanceof AdminMutationError) throw e;
  throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);
}
```

L'import de `OPAQUE_FILTER_ERROR` devient inutilisé dans `mutations.ts` : le retirer, sinon `pnpm run lint` le signale.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/mutationErrors.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Vérifier que les ~25 assertions existantes n'ont pas bougé**

Run: `pnpm exec vitest run tests/unit/fkEditable.test.ts tests/unit/m2mImplicit.test.ts tests/unit/handler.test.ts`
Expected: PASS sans qu'aucun de ces fichiers ait été modifié. C'est la preuve que les messages sont conservés au mot près. **Si l'un échoue, corriger le message levé, jamais le test.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/mutations.ts tests/unit/mutationErrors.test.ts
git commit -m "refactor: throw typed mutation errors instead of string sniffing"
```

---

### Task 4 : le handler ne rend plus jamais un message pilote

**Files:**
- Modify: `src/lib/server/handler.ts` — le site d'appel de `handleMutation` (actuellement ~ligne 326)
- Test: `tests/unit/mutationErrors.test.ts` (complété)

**Interfaces:**
- Consumes: `AdminMutationError` et `classifyWriteError` de Task 1 ; les throws typés de Task 3.
- Produces: rien de nouveau vers l'extérieur. `content` est rendu comme avant pour tout ce qui n'est pas une mutation.

- [ ] **Step 1: Write the failing test**

Ajouter à `tests/unit/mutationErrors.test.ts` :

```ts
describe('rendu des erreurs de mutation', () => {
  const GENERIC = 'The change could not be saved.';

  it('ne rend jamais le message d’une erreur pilote', async () => {
    const leak =
      'Invalid `prisma.user.create()` invocation: Unique constraint failed on the fields: (`email`)';
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@b.c' }] });
    prisma.user.create = () => {
      throw Object.assign(new Error(leak), { code: 'P2002' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({
      url: '/admin/user/new',
      body: { _action: 'create', email: 'a@b.c' }
    });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('prisma.user.create');
    expect(html).not.toContain('Unique constraint failed');
    expect(html).toContain('A record with these values already exists.');
  });

  it('rend un texte générique sur un code pilote inconnu, et journalise l’original', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = createPrismaMock({ user: [] });
    prisma.user.create = () => {
      throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
    };
    const handler = createAdminHandler({ prisma, prismaSchemaPath: FULL_SCHEMA_PATH } as any);
    const ev = createEvent({ url: '/admin/user/new', body: { _action: 'create', email: 'x@y.z' } });

    const html = await (await handler(ev as any)).text();

    expect(html).not.toContain('connection terminated');
    expect(html).toContain(GENERIC);
    expect(err).toHaveBeenCalled();
  });

  it('rend le message d’une AdminMutationError de validation, inchangé', async () => {
    const prisma = createPrismaMock({ user: [], post: [], tag: [] });
    const handler = createAdminHandler({
      prisma,
      prismaSchemaPath: RELATIONS_SCHEMA_PATH
    } as any);
    const ev = createEvent({
      url: '/admin/post/new',
      body: { _action: 'create', title: 'x', authorId: '999' }
    });

    expect(await (await handler(ev as any)).text()).toContain('author: invalid value');
  });
});
```

> `vi` doit être ajouté à l'import de `vitest` en tête de fichier. `FULL_SCHEMA_PATH` et `RELATIONS_SCHEMA_PATH` sont tous deux exportés par `tests/fixtures/prismaMock.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/mutationErrors.test.ts`
Expected: FAIL — le premier test trouve `prisma.user.create` dans le HTML, parce que le `catch` partagé rend `e.message` tel quel.

- [ ] **Step 3: Write minimal implementation**

Dans `src/lib/server/handler.ts`, remplacer le site d'appel actuel :

```ts
      if (event.request.method === 'POST') {
        const mutationResponse = await handleMutation(runtime, event, route as ParsedRoute);
        if (mutationResponse) return mutationResponse;
      }
```

par :

```ts
      if (event.request.method === 'POST') {
        // `try` propre au chemin de mutation, et non le `catch` partagé plus
        // bas : celui-ci couvre aussi le rendu GET et les pages de plugin,
        // dont le contrat (rendre le message levé) ne change pas ici.
        try {
          const mutationResponse = await handleMutation(runtime, event, route as ParsedRoute);
          if (mutationResponse) return mutationResponse;
        } catch (e: unknown) {
          const action = route.id ? 'update' : 'create';
          const classified = classifyWriteError(e, action);
          // Seul un message construit par la bibliothèque est rendu. Un code
          // pilote non reconnu ne remonte que journalisé : son texte porte le
          // nom de la table et un fragment de requête.
          if (!classified) {
            console.error('[sveltekit-admin] mutation failed:', e);
          }
          mutationError = classified?.message ?? 'The change could not be saved.';
        }
      }
```

Déclarer `mutationError` avec les autres `let` du bloc (à côté de `content`, `currentModel`, `extraStyles`, `extraScripts`) :

```ts
    let mutationError: string | undefined;
```

Puis, après le rendu de la vue GET et avant la construction du `Layout`, préfixer le contenu de l'alerte quand il y en a une :

```ts
    if (mutationError) {
      content =
        `<div class="ska-alert ska-alert--error">${escapeHtml(mutationError)}</div>` + content;
    }
```

Ajouter l'import :

```ts
import { classifyWriteError } from './errors.js';
```

**L'action passée à `classifyWriteError` :** `route.id ? 'update' : 'create'`. Le delete transite par le même POST mais son échec FK n'est traité qu'en PR 3 (`restrict`) ; ici il retombe sur `reference`, dont le message reste correct et sans fuite. Ne pas anticiper.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/mutationErrors.test.ts`
Expected: PASS — 6 tests dans le fichier.

- [ ] **Step 5: Vérifier la non-régression du chemin partagé**

Run: `pnpm exec vitest run tests/unit/handler.plugins.test.ts tests/unit/handler.test.ts`
Expected: PASS. `handler.plugins.test.ts:123` (`Error: kaboom &lt;img&gt;`) et `handler.test.ts:465` (`Unknown error`) doivent passer **sans modification** — ils prouvent que le `catch` partagé est intact.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/handler.ts tests/unit/mutationErrors.test.ts
git commit -m "fix: never render a driver error message on a failed mutation"
```

---

### Task 5 : snapshots, gate de couverture, changeset

**Files:**
- Modify: `tests/characterization/__snapshots__/handler.snapshot.test.ts.snap` (si et seulement si un diff apparaît)
- Create: `.changeset/typed-mutation-errors.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: PR prête.

- [ ] **Step 1: Lancer la suite complète**

Run: `pnpm run test`
Expected: soit tout passe, soit seuls des snapshots de caractérisation diffèrent.

- [ ] **Step 2: Relire chaque diff de snapshot ligne à ligne**

Run: `git diff tests/characterization/__snapshots__/`

Un diff attendu est **uniquement** le remplacement d'un message pilote par un message de la bibliothèque. Tout autre diff (un champ qui disparaît du formulaire, un status qui change, une ligne de liste qui bouge) est une régression : arrêter et la corriger.

**Ne jamais lancer `vitest -u` en bloc pour faire passer la CI.** Si le diff est confirmé correct, régénérer uniquement le fichier concerné :

Run: `pnpm exec vitest run tests/characterization/handler.snapshot.test.ts -u`

- [ ] **Step 3: Vérifier le gate de couverture**

Run: `pnpm run test:coverage`
Expected: 100 % sur les 4 métriques, `errors.ts` inclus. Une branche non couverte s'ajoute en test, jamais en `v8 ignore`.

Points d'attention connus : les branches `codeOf` (`code` vs `meta.code` vs aucun, et `typeof raw === 'string'` faux) et chaque ensemble de codes de `classifyWriteError` sont couverts par Task 1. La branche `classified?.message ?? …` de Task 4 est couverte par ses deux premiers tests.

- [ ] **Step 4: Vérifier check, lint et package**

Run: `pnpm run check && pnpm run lint && pnpm run package`
Expected: 0 erreur. `pnpm run lint` doit afficher le **même** nombre de warnings que sur `main` — vérifier avec `git stash && pnpm run lint | tail -2 && git stash pop` en cas de doute.

- [ ] **Step 5: Écrire le changeset**

```md
---
"sveltekit-admin": patch
---

A failed create or update no longer renders the database driver's own error message. Prisma's `P2002` used to reach the browser as ``Invalid `prisma.user.create()` invocation … Unique constraint failed on the fields: (`email`)``, query text included; unique, foreign-key and missing-row failures are now recognized by driver code (Prisma, PostgreSQL, MySQL, SQLite) and rendered as a fixed library message, with anything unrecognized logged server-side and shown as a generic one.

Validation refusals raised by the admin itself are unchanged, word for word — an invalid relation target still reads `author: invalid value`. Internally they carry a kind and a field instead of being recognized by substring matching on their own message, which is what made the leak possible to fix without touching them. Plugin pages and failed list reads keep rendering exactly as before.
```

- [ ] **Step 6: Commit et ouvrir la PR**

```bash
git add .changeset/typed-mutation-errors.md tests/characterization/
git commit -m "docs: changeset for typed mutation errors"
git push -u origin feat/actionable-mutation-errors
```

Ouvrir la PR contre `main`, en liant l'issue #25 et la spec.

---

## Self-Review

**Couverture de la spec (PR 1 uniquement) :**

| Élément de spec | Tâche |
|---|---|
| `errors.ts` : `MutationErrorKind`, `AdminMutationError`, `classifyWriteError` | 1 |
| Tableau des codes par moteur | 1 |
| `reference` vs `restrict` séparés par l'action | 1 |
| `codeOf` migre de `retry.ts`, un seul exemplaire | 2 |
| Les 14 throws deviennent typés, messages au mot près | 3 |
| Les 4 `includes('invalid value')` disparaissent | 3 |
| `try` propre à `handleMutation`, `catch` partagé intact | 4 |
| Seuls des messages de la bibliothèque sont rendus | 4 |
| Snapshots relus, jamais régénérés en bloc | 5 |
| Changeset en patch | 5 |

**Hors périmètre de ce plan, traité par les plans suivants :** réaffichage des valeurs soumises et `422` (PR 2) ; sonde d'unicité et suppression bloquée via `loadRelatedCounts` (PR 3). Le `restrict` produit par Task 1 n'est donc pas encore atteignable depuis un delete — c'est voulu, et Task 4 le dit explicitement.

**Cohérence des types :** `AdminMutationError(kind, message, field?)` a le même ordre d'arguments dans les tâches 1, 3 et 4. `classifyWriteError(error, action)` renvoie `AdminMutationError | null` partout. `codeOf` renvoie `string | undefined` en 1 comme en 2.
