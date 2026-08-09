import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSchemaContent } from '../../src/lib/server/introspection/parser.js';
import {
  resolveListFilters,
  validateListFilterConfig
} from '../../src/lib/server/query/filterDetection.js';
import { toLabel } from '../../src/lib/server/views/html.js';
import { SEARCH_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parseSchemaContent(readFileSync(SEARCH_SCHEMA_PATH, 'utf-8'));
const Article = schema.models.find((m) => m.name === 'Article')!;

describe('resolveListFilters — auto-détection (Boolean + enum)', () => {
  it('sans config : détecte published (Boolean) et status (enum)', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    expect(filters.map((f) => f.field).sort()).toEqual(['published', 'status']);
  });

  it('published est de kind boolean, sans enumValues', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    const published = filters.find((f) => f.field === 'published')!;
    expect(published.kind).toBe('boolean');
    expect(published.enumValues).toBeUndefined();
  });

  it('status est de kind enum, avec les membres du schéma', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    const status = filters.find((f) => f.field === 'status')!;
    expect(status.kind).toBe('enum');
    expect(status.enumValues).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
  });

  it('n\'auto-détecte jamais un champ sensible', () => {
    const s = parseSchemaContent(
      'model T {\n  id Int @id\n  isPasswordSet Boolean @default(false)\n}'
    );
    const filters = resolveListFilters(s.models[0], s.enums, undefined, toLabel);
    expect(filters).toEqual([]);
  });

  it('n\'auto-détecte jamais un champ relation/liste', () => {
    const s = parseSchemaContent(
      'model Tag { id Int @id }\nmodel T {\n  id Int @id\n  tags Tag[]\n}'
    );
    const filters = resolveListFilters(s.models[0], s.enums, undefined, toLabel);
    expect(filters).toEqual([]);
  });

  it('un champ String ou Int n\'est jamais auto-détecté', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    expect(filters.map((f) => f.field)).not.toContain('title');
    expect(filters.map((f) => f.field)).not.toContain('views');
  });

  it('modèle sans champ filtrable : tableau vide', () => {
    const s = parseSchemaContent('model T {\n  id Int @id\n  name String\n}');
    expect(resolveListFilters(s.models[0], s.enums, undefined, toLabel)).toEqual([]);
  });

  it('le label par défaut vient de toLabel (humanisation du nom de champ)', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    const published = filters.find((f) => f.field === 'published')!;
    expect(published.label).toBe(toLabel('published'));
  });
});

describe('resolveListFilters — config explicite listFilter', () => {
  it('forme courte (string) : reprend le champ tel quel', () => {
    const filters = resolveListFilters(Article, schema.enums, ['published'], toLabel);
    expect(filters).toEqual([{ field: 'published', label: toLabel('published'), kind: 'boolean' }]);
  });

  it('forme objet avec label personnalisé', () => {
    const filters = resolveListFilters(Article, schema.enums, [{ field: 'published', label: 'Publié ?' }], toLabel);
    expect(filters[0].label).toBe('Publié ?');
  });

  it('forme objet sans label : retombe sur toLabel', () => {
    const filters = resolveListFilters(Article, schema.enums, [{ field: 'status' }], toLabel);
    expect(filters[0].label).toBe(toLabel('status'));
  });

  it('la config explicite respecte l\'ordre déclaré', () => {
    const filters = resolveListFilters(Article, schema.enums, ['status', 'published'], toLabel);
    expect(filters.map((f) => f.field)).toEqual(['status', 'published']);
  });

  it('mélange forme courte et objet dans la même config', () => {
    const filters = resolveListFilters(
      Article, schema.enums, ['published', { field: 'status', label: 'État' }], toLabel
    );
    expect(filters[0].field).toBe('published');
    expect(filters[1]).toEqual({ field: 'status', label: 'État', kind: 'enum', enumValues: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] });
  });

  it('un champ configuré inexistant sur le modèle est silencieusement ignoré (défense en profondeur, hors validation de boot)', () => {
    // resolveListFilters ne valide pas elle-même — c'est validateListFilterConfig
    // qui le fait au boot. Appelée isolément (comme ici), un champ absent du
    // modèle ne doit jamais planter le rendu : il est juste sauté.
    const filters = resolveListFilters(Article, schema.enums, ['published', 'doesNotExist'], toLabel);
    expect(filters.map((f) => f.field)).toEqual(['published']);
  });

  it('un champ enum dont le type est absent de la map `enums` retombe sur un tableau vide plutôt que planter', () => {
    // Cas défensif : `enums` fourni ne correspond pas au schéma d'où vient
    // le champ (mauvais couplage schéma/enums côté appelant).
    const filters = resolveListFilters(Article, new Map(), ['status'], toLabel);
    expect(filters).toEqual([{ field: 'status', label: toLabel('status'), kind: 'enum', enumValues: [] }]);
  });
});

describe('resolveListFilters — DateTime (kind: datetime)', () => {
  it('auto-détection : n\'inclut JAMAIS un champ DateTime (config explicite requise)', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    expect(filters.map((f) => f.field)).not.toContain('createdAt');
  });

  it('config explicite (forme courte) : presets par défaut = les 4 raccourcis', () => {
    const filters = resolveListFilters(Article, schema.enums, ['createdAt'], toLabel);
    expect(filters[0]).toEqual({
      field: 'createdAt', label: toLabel('createdAt'), kind: 'datetime',
      presets: ['today', '7d', 'month', 'year']
    });
  });

  it('config explicite avec presets restreints', () => {
    const filters = resolveListFilters(
      Article, schema.enums, [{ field: 'createdAt', presets: ['today', 'year'] }], toLabel
    );
    expect(filters[0].presets).toEqual(['today', 'year']);
  });

  it('label personnalisé sur un champ DateTime', () => {
    const filters = resolveListFilters(
      Article, schema.enums, [{ field: 'createdAt', label: 'Créé le' }], toLabel
    );
    expect(filters[0].label).toBe('Créé le');
  });
});

describe('resolveListFilters — plages numériques (kind: range)', () => {
  it('auto-détection : n\'inclut JAMAIS un champ numérique (config explicite requise)', () => {
    const filters = resolveListFilters(Article, schema.enums, undefined, toLabel);
    expect(filters.map((f) => f.field)).not.toContain('views');
    expect(filters.map((f) => f.field)).not.toContain('price');
  });

  it('range:true sur Int : kind range', () => {
    const filters = resolveListFilters(Article, schema.enums, [{ field: 'views', range: true }], toLabel);
    expect(filters[0]).toEqual({ field: 'views', label: toLabel('views'), kind: 'range' });
  });

  it('range:true sur Decimal : kind range aussi', () => {
    const filters = resolveListFilters(Article, schema.enums, [{ field: 'price', range: true }], toLabel);
    expect(filters[0].kind).toBe('range');
  });

  it('un Int configuré SANS range:true n\'est pas résolu du tout (config invalide, mais resolveListFilters ne valide pas elle-même)', () => {
    const filters = resolveListFilters(Article, schema.enums, ['views'], toLabel);
    expect(filters).toEqual([]);
  });
});

describe('validateListFilterConfig — fail loud au boot', () => {
  it('accepte une config valide sans lever', () => {
    expect(() => validateListFilterConfig('Article', ['published', 'status'], Article)).not.toThrow();
  });

  it('lève sur un champ inexistant', () => {
    expect(() => validateListFilterConfig('Article', ['nope'], Article)).toThrow(/no field "nope"/);
  });

  it('lève sur un champ relation', () => {
    const s = parseSchemaContent('model Tag { id Int @id }\nmodel T {\n  id Int @id\n  tags Tag[]\n}');
    expect(() => validateListFilterConfig('T', ['tags'], s.models[1])).toThrow(/relation\/list field/);
  });

  it('lève sur un champ Json', () => {
    expect(() => validateListFilterConfig('Article', ['metadata'], Article)).toThrow(/not filterable/);
  });

  it('lève sur un champ Bytes', () => {
    expect(() => validateListFilterConfig('Article', ['attachment'], Article)).toThrow(/not filterable/);
  });

  it('lève sur un champ sensible même s\'il est par ailleurs Boolean', () => {
    const s = parseSchemaContent('model T {\n  id Int @id\n  hasToken Boolean @default(false)\n}');
    expect(() => validateListFilterConfig('T', ['hasToken'], s.models[0])).toThrow(/sensitive/);
  });

  it('lève sur un champ String ou Int (type non supporté par la sidebar en v1)', () => {
    expect(() => validateListFilterConfig('Article', ['title'], Article)).toThrow(/only Boolean, enum, DateTime/);
    expect(() => validateListFilterConfig('Article', ['views'], Article)).toThrow(/only Boolean, enum, DateTime/);
  });

  it('accepte la forme objet pour la validation aussi', () => {
    expect(() => validateListFilterConfig('Article', [{ field: 'published' }], Article)).not.toThrow();
  });

  it('lève sur la première entrée invalide d\'une liste, même si les autres sont valides', () => {
    expect(() => validateListFilterConfig('Article', ['published', 'nope'], Article)).toThrow(/no field "nope"/);
  });

  it('accepte une config range:true sur un champ numérique (Int)', () => {
    expect(() => validateListFilterConfig('Article', [{ field: 'views', range: true }], Article)).not.toThrow();
  });

  it('accepte une config range:true sur un champ numérique (Decimal)', () => {
    expect(() => validateListFilterConfig('Article', [{ field: 'price', range: true }], Article)).not.toThrow();
  });

  it('lève si range:true est posé sur un champ non numérique', () => {
    expect(() =>
      validateListFilterConfig('Article', [{ field: 'title', range: true }], Article)
    ).toThrow(/range:true but type String is not numeric/);
  });

  it('accepte un champ DateTime sans presets (defaults appliqués à la résolution)', () => {
    expect(() => validateListFilterConfig('Article', ['createdAt'], Article)).not.toThrow();
  });

  it('accepte un champ DateTime avec des presets valides', () => {
    expect(() =>
      validateListFilterConfig('Article', [{ field: 'createdAt', presets: ['today', 'year'] }], Article)
    ).not.toThrow();
  });

  it('lève si presets est posé sur un champ non-DateTime', () => {
    expect(() =>
      validateListFilterConfig('Article', [{ field: 'views', presets: ['today'] }], Article)
    ).toThrow(/has presets but is not a DateTime field/);
  });

  it('lève sur un preset inconnu', () => {
    expect(() =>
      validateListFilterConfig('Article', [{ field: 'createdAt', presets: ['nextCentury' as any] }], Article)
    ).toThrow(/unknown preset\(s\) nextCentury/);
  });

  it('un champ Int sans range:true reste rejeté (String/Int libres toujours interdits)', () => {
    expect(() => validateListFilterConfig('Article', ['views'], Article)).toThrow(/only Boolean, enum, DateTime/);
  });
});
