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
