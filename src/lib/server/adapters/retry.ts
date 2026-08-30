/**
 * Reprise bornée des écritures transactionnelles.
 *
 * Une transaction `SERIALIZABLE` peut échouer sur un conflit que le moteur ne
 * sait pas ordonner (PostgreSQL 40001) ou sur un deadlock (PostgreSQL 40P01,
 * MySQL 1213). Ces échecs sont transitoires par construction : la transaction
 * a été annulée entièrement, elle n'a donc rien écrit, et rejouer le même
 * travail sur un instantané neuf aboutit presque toujours. Sans reprise ils
 * remontent en 500 alors que rien n'est cassé.
 *
 * On ne rejoue QUE ces codes. Un refus de scope (« outside the authorization
 * scope ») ou une FK invalide ne sont pas transitoires : les rejouer ne ferait
 * que répéter le même refus, et masquerait un refus légitime derrière une
 * latence. Le défaut est donc de laisser remonter.
 *
 * Pas de temporisation entre les tentatives : au moment où le moteur signale
 * le conflit, la transaction concurrente est déjà terminée (committée ou
 * annulée), donc attendre ne change rien à la probabilité de succès. Cela
 * évite aussi d'introduire des minuteurs dans un chemin d'écriture.
 */

import { codeOf } from '../errors.js';

/** Codes que le moteur n'émet que pour un conflit de concurrence annulable. */
const RETRYABLE_CODES = new Set([
  '40001', // PostgreSQL / CockroachDB — serialization_failure
  '40P01', // PostgreSQL — deadlock_detected
  'ER_LOCK_DEADLOCK', // MySQL 1213
  'ER_LOCK_WAIT_TIMEOUT' // MySQL 1205
]);

export function isRetryableWriteError(error: unknown): boolean {
  const code = codeOf(error);
  return code !== undefined && RETRYABLE_CODES.has(code);
}

/**
 * Exécute `run`, en le rejouant tant que l'échec est un conflit de concurrence
 * et que le budget de tentatives n'est pas épuisé. `attempts` compte la
 * tentative initiale : 3 signifie « un essai puis deux reprises ».
 */
export async function withWriteRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  // La boucle ne couvre que les reprises ; la dernière tentative est le `run`
  // final, dont l'échec remonte tel quel. Écrit ainsi plutôt qu'en boucle
  // infinie avec un `throw` de sortie : celle-ci n'aurait aucune sortie
  // normale, donc une branche inatteignable et non testable.
  for (let remaining = attempts - 1; remaining > 0; remaining -= 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableWriteError(error)) throw error;
    }
  }
  return run();
}
