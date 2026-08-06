import { describe, it, expect } from 'vitest';
import { defaultAdminCheck } from '../../src/lib/server/auth.js';

describe('defaultAdminCheck', () => {
  it.each([
    [{ role: 'admin' }, undefined, true],
    [{ role: 'user' }, undefined, false],
    [{ isAdmin: true }, undefined, true],
    [{ isAdmin: 'yes' }, undefined, false],
    [{ roles: ['editor', 'admin'] }, undefined, true],
    [{ roles: ['editor'] }, undefined, false],
    [{ roles: 'admin' }, undefined, false],
    [{}, undefined, false],
    [{ role: 'superuser' }, 'superuser', true],
    [{ role: 'admin' }, 'superuser', false],
    [{ roles: ['superuser'] }, 'superuser', true],
    [null, undefined, false],
    [undefined, undefined, false],
    ['admin', undefined, false],
    [42, undefined, false]
  ])('%o avec rôle %s → %s', (user, role, expected) => {
    expect(defaultAdminCheck(user, role)).toBe(expected);
  });
});
