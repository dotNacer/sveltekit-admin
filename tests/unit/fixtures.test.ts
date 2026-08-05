import { describe, it, expect } from 'vitest';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { createEvent } from '../fixtures/events.js';
import { readFileSync } from 'node:fs';

describe('fixtures', () => {
  it('lit le schéma complet', () => {
    expect(readFileSync(FULL_SCHEMA_PATH, 'utf-8')).toContain('model User');
  });

  it('journalise les appels prisma', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1 }, { id: 2 }] });
    await prisma.user.findMany({ skip: 1, take: 1 });
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toEqual({ skip: 1, take: 1 });
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.user.findUnique({ where: { id: 2 } })).toEqual({ id: 2 });
  });

  it('permet de forcer une erreur', async () => {
    const prisma = createPrismaMock({ user: [] }, { user: { count: () => { throw new Error('boom'); } } });
    await expect(async () => prisma.user.count()).rejects.toThrow('boom');
  });

  it('construit un POST lisible en formData', async () => {
    const { event, resolve } = createEvent({ url: '/admin/user/1', body: { _action: 'delete' } });
    expect(event.request.method).toBe('POST');
    expect((await event.request.formData()).get('_action')).toBe('delete');
    expect(resolve.called).toBe(false);
  });
});
