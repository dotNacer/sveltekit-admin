import { describe, it, expect } from 'vitest';
import { resolveDashboard } from '../../src/lib/server/dashboard.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const models = schema.models;

describe('resolveDashboard', () => {
  it('sans config, rend les widgets historiques', () => {
    const resolved = resolveDashboard({ models });
    expect(resolved.title).toBe('Dashboard');
    expect(resolved.subtitle).toBe('Welcome to your admin panel');
    expect(resolved.widgets).toEqual([
      { type: 'stats' },
      { type: 'models', title: 'Models', modelNames: ['User', 'Post', 'Category'] }
    ]);
  });

  it('accepte un dashboard vide', () => {
    expect(resolveDashboard({ config: { widgets: [] }, models }).widgets).toEqual([]);
  });

  it('respecte l’ordre et les titres déclarés', () => {
    const resolved = resolveDashboard({
      config: {
        title: 'Console',
        subtitle: 'Tout va bien',
        widgets: [
          { type: 'models', title: 'Contenu', models: ['Post'] },
          { type: 'stats' },
          { type: 'models', title: 'Comptes', models: ['User'] }
        ]
      },
      models
    });
    expect(resolved.title).toBe('Console');
    expect(resolved.subtitle).toBe('Tout va bien');
    expect(resolved.widgets.map((w) => w.type)).toEqual(['models', 'stats', 'models']);
    expect(resolved.widgets[0]).toEqual({ type: 'models', title: 'Contenu', modelNames: ['Post'] });
  });

  it('refuse un type de widget inconnu', () => {
    expect(() =>
      resolveDashboard({ config: { widgets: [{ type: 'chart' } as any] }, models })
    ).toThrow(/dashboard\.widgets\[0\].*unknown type "chart"/);
  });

  it('refuse un modèle inconnu ou exclu', () => {
    expect(() =>
      resolveDashboard({ config: { widgets: [{ type: 'models', models: ['Session'] }] }, models })
    ).toThrow(/dashboard\.widgets\[0\].*"Session".*unknown or excluded/);
  });

  it('accepte un widget models sans titre', () => {
    const resolved = resolveDashboard({
      config: { widgets: [{ type: 'models', models: ['User'] }] },
      models
    });
    expect(resolved.widgets[0]).toEqual({ type: 'models', modelNames: ['User'] });
  });
});
