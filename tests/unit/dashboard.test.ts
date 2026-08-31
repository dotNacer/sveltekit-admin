import { describe, it, expect } from 'vitest';
import { resolveDashboard, groupWidgetRows } from '../../src/lib/server/dashboard.js';
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

const modelCard = (name: string) => ({
  name,
  label: name,
  count: 1,
  href: `/admin/${name.toLowerCase()}`,
  newHref: `/admin/${name.toLowerCase()}/new`
});

describe('groupWidgetRows', () => {
  it('développe un widget stats en deux cartes', () => {
    const rows = groupWidgetRows([{ type: 'stats', models: 3, total: 42 }]);
    expect(rows).toEqual([
      {
        kind: 'cards',
        cards: [
          { value: 3, label: 'Models', icon: 'models' },
          { value: 42, label: 'Total Records', icon: 'records' }
        ]
      }
    ]);
  });

  it('rend un widget models dans sa propre rangée', () => {
    const rows = groupWidgetRows([
      { type: 'models', title: 'Contenu', cards: [modelCard('Post')] }
    ]);
    expect(rows).toEqual([
      { kind: 'models', title: 'Contenu', cards: [modelCard('Post')] }
    ]);
  });

  it('n’ouvre pas de rangée de cartes après un widget models', () => {
    const rows = groupWidgetRows([
      { type: 'models', cards: [modelCard('Post')] },
      { type: 'stats', models: 1, total: 1 }
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['models', 'cards']);
  });

  it('replie deux widgets-cartes adjacents dans la même rangée', () => {
    const rows = groupWidgetRows([
      { type: 'stats', models: 1, total: 1 },
      { type: 'stats', models: 2, total: 2 }
    ]);
    expect(rows).toEqual([
      {
        kind: 'cards',
        cards: [
          { value: 1, label: 'Models', icon: 'models' },
          { value: 1, label: 'Total Records', icon: 'records' },
          { value: 2, label: 'Models', icon: 'models' },
          { value: 2, label: 'Total Records', icon: 'records' }
        ]
      }
    ]);
  });

  it('rend une liste vide pour un dashboard vide', () => {
    expect(groupWidgetRows([])).toEqual([]);
  });
});
