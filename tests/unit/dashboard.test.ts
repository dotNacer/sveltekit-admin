import { describe, it, expect } from 'vitest';
import { resolveDashboard, groupWidgetRows } from '../../src/lib/server/dashboard.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';
import { resolveSearchFields } from '../../src/lib/server/query/listQuery.js';
import { isSensitiveFieldName } from '../../src/lib/server/introspection/parser.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const models = schema.models;

const deps = (config?: any) => ({
  config,
  models,
  enums: schema.enums,
  basePath: '/admin',
  searchFieldsOf: (m: any) => resolveSearchFields(m, undefined, ['name', 'email', 'title'], new Set()),
  filterableFieldsOf: (m: any): Set<string> =>
    new Set<string>(
      m.fields
        .filter(
          (f: any) =>
            !f.relation &&
            !f.isList &&
            !['Json', 'Bytes'].includes(f.type) &&
            !isSensitiveFieldName(f.name)
        )
        .map((f: any) => f.name as string)
    )
});

describe('resolveDashboard', () => {
  it('sans config, rend les widgets historiques', () => {
    const resolved = resolveDashboard(deps());
    expect(resolved.title).toBe('Dashboard');
    expect(resolved.subtitle).toBe('Welcome to your admin panel');
    expect(resolved.widgets).toEqual([
      { type: 'stats' },
      { type: 'models', title: 'Models', modelNames: ['User', 'Post', 'Category'] }
    ]);
  });

  it('accepte un dashboard vide', () => {
    expect(resolveDashboard(deps({ widgets: [] })).widgets).toEqual([]);
  });

  it('respecte l’ordre et les titres déclarés', () => {
    const resolved = resolveDashboard(
      deps({
        title: 'Console',
        subtitle: 'Tout va bien',
        widgets: [
          { type: 'models', title: 'Contenu', models: ['Post'] },
          { type: 'stats' },
          { type: 'models', title: 'Comptes', models: ['User'] }
        ]
      })
    );
    expect(resolved.title).toBe('Console');
    expect(resolved.subtitle).toBe('Tout va bien');
    expect(resolved.widgets.map((w) => w.type)).toEqual(['models', 'stats', 'models']);
    expect(resolved.widgets[0]).toEqual({ type: 'models', title: 'Contenu', modelNames: ['Post'] });
  });

  it('refuse un type de widget inconnu', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'chart' } as any] }))
    ).toThrow(/dashboard\.widgets\[0\].*unknown type "chart"/);
  });

  it('refuse un modèle inconnu ou exclu', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'models', models: ['Session'] }] }))
    ).toThrow(/dashboard\.widgets\[0\].*"Session".*unknown or excluded/);
  });

  it('accepte un widget models sans titre', () => {
    const resolved = resolveDashboard(deps({ widgets: [{ type: 'models', models: ['User'] }] }));
    expect(resolved.widgets[0]).toEqual({ type: 'models', modelNames: ['User'] });
  });
});

describe('resolveDashboard — widget count', () => {
  it('parse la query au boot et construit le lien vers la liste', () => {
    const [widget] = resolveDashboard(
      deps({ widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }] })
    ).widgets;
    expect(widget).toMatchObject({
      type: 'count',
      modelName: 'User',
      label: 'Actifs',
      href: '/admin/user?f.isActive=true'
    });
    expect((widget as any).query.filters).toHaveLength(1);
  });

  it('accepte un compteur sans query', () => {
    const [widget] = resolveDashboard(
      deps({ widgets: [{ type: 'count', model: 'User', label: 'Tous' }] })
    ).widgets;
    expect(widget).toMatchObject({ href: '/admin/user' });
  });

  it('trie les paramètres du lien', () => {
    const [widget] = resolveDashboard(
      deps({
        widgets: [{ type: 'count', model: 'User', label: 'X', query: 'q=bob&f.isActive=true' }]
      })
    ).widgets;
    expect((widget as any).href).toBe('/admin/user?f.isActive=true&q=bob');
  });

  it('refuse un filtre sur un champ sensible', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'f.password=x' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*"f\.password"/);
  });

  it('refuse un filtre sur un champ inexistant', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'f.nope=1' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*"f\.nope"/);
  });

  it('refuse un paramètre qui n’a aucun effet sur un comptage', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'page=2' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*only "q" and "f\.\*" are supported.*"page"/);
  });

  it('refuse un compteur sans libellé', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'count', model: 'User', label: '  ' }] }))
    ).toThrow(/dashboard\.widgets\[0\].*non-empty `label`/);
  });

  it('refuse un compteur sur un modèle exclu', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'count', model: 'Session', label: 'X' }] }))
    ).toThrow(/unknown or excluded/);
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
