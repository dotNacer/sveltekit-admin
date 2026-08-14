import { describe, it, expect } from 'vitest';
import { createPrismaAdapter, resolveCaseInsensitiveSearch } from '../../../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, FULL_SCHEMA_PATH } from '../../../fixtures/prismaMock.js';

describe('createPrismaAdapter', () => {
  it('compose introspector + data en un seul objet fonctionnel', async () => {
    const prisma = createPrismaMock({ user: [{ id: 1, email: 'a@x.y' }] });
    const adapter = createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH });

    const schema = await adapter.introspector.introspect();
    const User = schema.models.find((m) => m.name === 'User')!;

    const { rows, total } = await adapter.data.listRecords(User, { skip: 0, take: 20 });
    expect(total).toBe(1);
    expect(rows).toEqual([{ id: 1, email: 'a@x.y' }]);
  });
});

describe('resolveCaseInsensitiveSearch', () => {
  it("searchMode: 'insensitive' force true, quel que soit le provider", () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map(), provider: 'sqlite' }, 'insensitive')).toBe(true);
  });

  it("searchMode: 'auto' + provider postgresql -> true", () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map(), provider: 'postgresql' }, 'auto')).toBe(true);
  });

  it("searchMode: 'auto' + provider non supporté -> false", () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map(), provider: 'sqlite' }, 'auto')).toBe(false);
  });

  it("searchMode: 'default' -> toujours false", () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map(), provider: 'postgresql' }, 'default')).toBe(false);
  });

  it('schema null (introspection ratée) -> false, sans throw', () => {
    expect(resolveCaseInsensitiveSearch(null, 'auto')).toBe(false);
  });

  it('schema sans provider -> false', () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map() }, 'auto')).toBe(false);
  });

  it('searchMode par défaut (omis) == auto', () => {
    expect(resolveCaseInsensitiveSearch({ models: [], enums: new Map(), provider: 'mongodb' })).toBe(true);
  });
});
