import { describe, expect, it, vi } from 'vitest';
import { isRetryableWriteError, withWriteRetry } from '../../../src/lib/server/adapters/retry.js';

const err = (code: unknown) => Object.assign(new Error('boom'), { code });

describe('isRetryableWriteError', () => {
  it('reconnaît les conflits de concurrence annulables', () => {
    expect(isRetryableWriteError(err('40001'))).toBe(true); // PostgreSQL serialization_failure
    expect(isRetryableWriteError(err('40P01'))).toBe(true); // PostgreSQL deadlock_detected
    expect(isRetryableWriteError(err('ER_LOCK_DEADLOCK'))).toBe(true);
    expect(isRetryableWriteError(err('ER_LOCK_WAIT_TIMEOUT'))).toBe(true);
  });

  it('lit aussi le code sous meta, comme le pose Prisma', () => {
    expect(isRetryableWriteError({ meta: { code: '40001' } })).toBe(true);
  });

  it('ne rejoue ni un refus de scope, ni un code inconnu, ni un code non-string', () => {
    expect(isRetryableWriteError(new Error('record is outside the authorization scope'))).toBe(false);
    expect(isRetryableWriteError(err('23505'))).toBe(false); // unique_violation
    expect(isRetryableWriteError(err(40001))).toBe(false); // numérique, pas SQLSTATE
    expect(isRetryableWriteError(null)).toBe(false);
    expect(isRetryableWriteError(undefined)).toBe(false);
  });
});

describe('withWriteRetry', () => {
  it('renvoie le résultat sans rejouer quand la première tentative réussit', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    await expect(withWriteRetry(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejoue un conflit de sérialisation puis renvoie le résultat', async () => {
    const run = vi.fn().mockRejectedValueOnce(err('40001')).mockResolvedValue('ok');
    await expect(withWriteRetry(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("laisse remonter immédiatement un échec non transitoire", async () => {
    // Un refus de scope rejoué ne ferait que répéter le même refus.
    const run = vi.fn().mockRejectedValue(new Error('record is outside the authorization scope'));
    await expect(withWriteRetry(run)).rejects.toThrow(/outside the authorization scope/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('abandonne une fois le budget de tentatives épuisé', async () => {
    const run = vi.fn().mockRejectedValue(err('40P01'));
    await expect(withWriteRetry(run)).rejects.toMatchObject({ code: '40P01' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('respecte un budget explicite', async () => {
    const run = vi.fn().mockRejectedValue(err('40001'));
    await expect(withWriteRetry(run, 2)).rejects.toMatchObject({ code: '40001' });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
