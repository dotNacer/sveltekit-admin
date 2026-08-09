import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSchemaContent
} from '../../src/lib/server/introspection/parser.js';
import {
  parseListQuery,
  buildWhere,
  resolveSearchFields,
  resolveDateShortcut,
  DEFAULT_LABEL_FIELDS,
  type ListQuery
} from '../../src/lib/server/query/listQuery.js';
import { SEARCH_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parseSchemaContent(readFileSync(SEARCH_SCHEMA_PATH, 'utf-8'));
const Article = schema.models.find((m) => m.name === 'Article')!;
const fieldNames = Article.fields.map((f) => f.name);
const allFilterable = new Set(fieldNames);

function qs(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

const FIXED_NOW = () => new Date('2026-08-09T15:30:00.000Z');

describe('resolveSearchFields — heuristique par défaut (labelFields)', () => {
  it('sans config : reprend name/title/label/email/username/slug parmi les String non sensibles', () => {
    const fields = resolveSearchFields(Article, undefined);
    expect(fields.sort()).toEqual(['slug', 'title']);
  });

  it('exclut les champs sensibles même s\'ils matchent labelFields', () => {
    // apiToken/authorHash ne sont pas dans labelFields de toute façon, mais on
    // vérifie explicitement qu'un champ sensible ne serait jamais retenu.
    const fields = resolveSearchFields(Article, undefined);
    expect(fields).not.toContain('apiToken');
    expect(fields).not.toContain('authorHash');
  });

  it('exclut l\'id même de type String', () => {
    const s = parseSchemaContent('model T {\n  id String @id\n  name String\n}');
    const fields = resolveSearchFields(s.models[0], undefined);
    expect(fields).not.toContain('id');
    expect(fields).toContain('name');
  });

  it('renvoie un tableau vide si aucun champ ne matche (pas de fallback "tous les String")', () => {
    const s = parseSchemaContent('model T {\n  id Int @id\n  weirdColumn String\n}');
    expect(resolveSearchFields(s.models[0], undefined)).toEqual([]);
  });

  it('accepte une liste labelFields personnalisée', () => {
    const s = parseSchemaContent('model T {\n  id Int @id\n  custom String\n}');
    expect(resolveSearchFields(s.models[0], undefined, ['custom'])).toEqual(['custom']);
  });
});

describe('resolveSearchFields — config explicite searchFields', () => {
  it('la config gagne sur l\'heuristique', () => {
    expect(resolveSearchFields(Article, ['content'])).toEqual(['content']);
  });

  it('rejette un champ sensible même configuré explicitement', () => {
    expect(resolveSearchFields(Article, ['apiToken', 'title'])).toEqual(['title']);
  });

  it('rejette un champ Json/Bytes/relation configuré explicitement', () => {
    expect(resolveSearchFields(Article, ['metadata', 'attachment', 'title'])).toEqual(['title']);
  });

  it('rejette un champ relation (isList) configuré explicitement', () => {
    const s = parseSchemaContent(
      'model Author { id Int @id }\nmodel T {\n  id Int @id\n  title String\n  authors Author[]\n}'
    );
    const T = s.models.find((m) => m.name === 'T')!;
    expect(resolveSearchFields(T, ['authors', 'title'])).toEqual(['title']);
  });

  it('rejette un champ inexistant sur le modèle', () => {
    expect(resolveSearchFields(Article, ['nope', 'title'])).toEqual(['title']);
  });

  it('accepte un champ non-String (Int, etc.) configuré explicitement', () => {
    expect(resolveSearchFields(Article, ['views'])).toEqual(['views']);
  });
});

describe('parseListQuery — recherche texte (q)', () => {
  const searchFields = ['title', 'slug'];

  it('extrait q, trim les espaces', () => {
    const query = parseListQuery(qs('q=%20hello%20'), Article, schema.enums, searchFields, allFilterable);
    expect(query.q).toBe('hello');
  });

  it('q absent → null', () => {
    const query = parseListQuery(qs(''), Article, schema.enums, searchFields, allFilterable);
    expect(query.q).toBeNull();
  });

  it('q vide ou espaces seuls → null (pas de clause de recherche)', () => {
    expect(parseListQuery(qs('q='), Article, schema.enums, searchFields, allFilterable).q).toBeNull();
    expect(parseListQuery(qs('q=%20%20'), Article, schema.enums, searchFields, allFilterable).q).toBeNull();
  });

  it('q très long est tronqué à 200 caractères', () => {
    const long = 'a'.repeat(500);
    const query = parseListQuery(qs(`q=${long}`), Article, schema.enums, searchFields, allFilterable);
    expect(query.q?.length).toBe(200);
  });
});

describe('parseListQuery — filtres f.<field>', () => {
  it('égalité par défaut (pas d\'opérateur)', () => {
    const query = parseListQuery(qs('f.title=Hello'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([{ field: 'title', op: 'equals', value: 'Hello', raw: 'Hello' }]);
  });

  it('opérateur explicite via __op', () => {
    const query = parseListQuery(qs('f.title__contains=ell'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ field: 'title', op: 'contains', value: 'ell' });
  });

  it('startsWith sur String', () => {
    const query = parseListQuery(qs('f.title__startsWith=Hel'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'startsWith', value: 'Hel' });
  });

  it('gte/lte refusés sur String (hors whitelist)', () => {
    const query = parseListQuery(qs('f.title__gte=A'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored).toEqual([{ param: 'f.title__gte', reason: 'bad-operator' }]);
  });

  it('contains refusé sur Int', () => {
    const query = parseListQuery(qs('f.views__contains=1'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-operator');
  });

  it('Int : coercion stricte, "12abc" est ignoré (pas parseInt)', () => {
    const query = parseListQuery(qs('f.views=12abc'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0]).toEqual({ param: 'f.views', reason: 'bad-value' });
  });

  it('Int : valeur vide ignorée sans être NaN', () => {
    const query = parseListQuery(qs('f.views='), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('Int : valeur négative acceptée', () => {
    const query = parseListQuery(qs('f.views=-5'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ value: -5 });
  });

  it('Int : gte/lte fonctionnent', () => {
    const query = parseListQuery(qs('f.views__gte=10'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'gte', value: 10 });
  });

  it('Int : un entier hors de la plage sûre (Number.isSafeInteger) est ignoré', () => {
    const query = parseListQuery(qs('f.views=99999999999999999999'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('BigInt : coercion en bigint natif', () => {
    const query = parseListQuery(qs('f.bigCounter=42'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0].value).toBe(42n);
  });

  it('BigInt invalide ignoré', () => {
    const query = parseListQuery(qs('f.bigCounter=abc'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('BigInt : une valeur numériquement valide mais hors plage BigInt native reste acceptée', () => {
    // BigInt("99999999999999999999999999999") ne throw pas (contrairement à
    // Number qui perdrait la précision) — ce test documente que la regex
    // stricte laisse passer de très grands entiers, et que BigInt() les
    // gère nativement sans le catch.
    const query = parseListQuery(qs('f.bigCounter=99999999999999999999999999999'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0].value).toBe(99999999999999999999999999999n);
  });

  it('Float : coercion en Number', () => {
    const query = parseListQuery(qs('f.rating=4.5'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0].value).toBe(4.5);
  });

  it('Decimal : reste une string (pas de perte de précision)', () => {
    const query = parseListQuery(qs('f.price=19.99'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0].value).toBe('19.99');
  });

  it('Float/Decimal invalides ignorés', () => {
    const q1 = parseListQuery(qs('f.rating=abc'), Article, schema.enums, [], allFilterable);
    expect(q1.filters).toEqual([]);
  });

  it('Boolean : true/1 → true, false/0 → false', () => {
    expect(parseListQuery(qs('f.published=true'), Article, schema.enums, [], allFilterable).filters[0].value).toBe(true);
    expect(parseListQuery(qs('f.published=1'), Article, schema.enums, [], allFilterable).filters[0].value).toBe(true);
    expect(parseListQuery(qs('f.published=false'), Article, schema.enums, [], allFilterable).filters[0].value).toBe(false);
    expect(parseListQuery(qs('f.published=0'), Article, schema.enums, [], allFilterable).filters[0].value).toBe(false);
  });

  it('Boolean : valeur invalide ignorée', () => {
    const query = parseListQuery(qs('f.published=maybe'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('enum : valeur valide acceptée', () => {
    const query = parseListQuery(qs('f.status=PUBLISHED'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'equals', value: 'PUBLISHED' });
  });

  it('enum : valeur hors liste ignorée', () => {
    const query = parseListQuery(qs('f.status=NOPE'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('enum : seul equals est permis (gte refusé)', () => {
    const query = parseListQuery(qs('f.status__gte=DRAFT'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('enum : map d\'enums ne contenant pas le type du champ → toute valeur rejetée', () => {
    // Défense en profondeur : si l'appelant passe une map d'enums qui ne
    // recense pas ce type (schéma désynchronisé, mauvaise map), on refuse
    // plutôt que de planter sur un `.includes` sur `undefined`.
    const query = parseListQuery(qs('f.status=PUBLISHED'), Article, new Map(), [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('champ inconnu → ignoré, reason unknown-field', () => {
    const query = parseListQuery(qs('f.nope=x'), Article, schema.enums, [], allFilterable);
    expect(query.ignored).toEqual([{ param: 'f.nope', reason: 'unknown-field' }]);
  });

  it('champ non filtrable (Json) → ignoré', () => {
    const query = parseListQuery(qs('f.metadata=x'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('champ Bytes filtrable exclu par filterableFields (simulateur de config)', () => {
    const restricted = new Set(fieldNames.filter((n) => n !== 'attachment'));
    const query = parseListQuery(qs('f.attachment=x'), Article, schema.enums, [], restricted);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('unknown-field');
  });

  it('isnull=1 sur champ optionnel → {equals: null}', () => {
    const query = parseListQuery(qs('f.content__isnull=1'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'isnull', value: true });
  });

  it('isnull=0 sur champ optionnel → not null', () => {
    const query = parseListQuery(qs('f.content__isnull=0'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'isnull', value: false });
  });

  it('isnull refusé sur un champ required', () => {
    const query = parseListQuery(qs('f.title__isnull=1'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('not-filterable');
  });

  it('isnull avec une valeur ni 1/true ni 0/false est ignoré', () => {
    const query = parseListQuery(qs('f.content__isnull=maybe'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('deux filtres actifs sont tous deux retenus', () => {
    const query = parseListQuery(qs('f.published=true&f.views__gte=5'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toHaveLength(2);
  });

  it('même clé répétée : on prend la première (searchParams.get)', () => {
    const params = new URLSearchParams();
    params.append('f.title', 'first');
    params.append('f.title', 'second');
    const query = parseListQuery(params, Article, schema.enums, [], allFilterable);
    expect(query.filters[0].value).toBe('first');
  });

  it('opérateur inconnu dans __op est rejeté proprement', () => {
    const query = parseListQuery(qs('f.title__frobnicate=x'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-operator');
  });
});

describe('parseListQuery — filtres DateTime', () => {
  it('today → intervalle [00:00 aujourd\'hui, 00:00 demain[', () => {
    const query = parseListQuery(qs('f.createdAt=today'), Article, schema.enums, [], allFilterable, FIXED_NOW);
    const clause = query.filters[0];
    expect(clause.op).toBe('gte');
    const range = clause.value as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('7d → 7 derniers jours', () => {
    const query = parseListQuery(qs('f.createdAt=7d'), Article, schema.enums, [], allFilterable, FIXED_NOW);
    const range = query.filters[0].value as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('month → mois courant', () => {
    const query = parseListQuery(qs('f.createdAt=month'), Article, schema.enums, [], allFilterable, FIXED_NOW);
    const range = query.filters[0].value as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('year → année courante', () => {
    const query = parseListQuery(qs('f.createdAt=year'), Article, schema.enums, [], allFilterable, FIXED_NOW);
    const range = query.filters[0].value as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('date ISO seule → intervalle d\'un jour, jamais equals', () => {
    const query = parseListQuery(qs('f.createdAt=2026-01-15'), Article, schema.enums, [], allFilterable);
    const range = query.filters[0].value as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });

  it('date invalide (2026-13-45) est ignorée', () => {
    const query = parseListQuery(qs('f.createdAt=2026-13-45'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('date invalide par rollover réel (31 février) est ignorée', () => {
    // Mois (02) et jour (31) sont chacun dans leur plage nominale 1-12/1-31,
    // mais février n'a jamais 31 jours : Date.UTC roule sur mars sans lever,
    // d'où la vérification a posteriori (année/mois/jour effectifs).
    const query = parseListQuery(qs('f.createdAt=2026-02-31'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].reason).toBe('bad-value');
  });

  it('raccourci inconnu est ignoré', () => {
    const query = parseListQuery(qs('f.createdAt=nonsense'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('gte/lte sur DateTime acceptent une date ou un datetime ISO', () => {
    const query = parseListQuery(qs('f.createdAt__gte=2026-01-01T10:00:00.000Z'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0].op).toBe('gte');
    expect((query.filters[0].value as Date).toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('gte avec une valeur non parsable est ignoré', () => {
    const query = parseListQuery(qs('f.createdAt__gte=not-a-date'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('isnull fonctionne sur un DateTime optionnel', () => {
    const query = parseListQuery(qs('f.publishedAt__isnull=1'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ op: 'isnull', value: true });
  });
});

describe('resolveDateShortcut (unité directe, hors parseListQuery)', () => {
  it('renvoie undefined pour une entrée non reconnue', () => {
    expect(resolveDateShortcut('banana', FIXED_NOW)).toBeUndefined();
  });

  it('utilise `new Date()` par défaut quand now n\'est pas fourni', () => {
    // On ne peut pas figer l'heure ici, on vérifie juste que ça ne plante
    // pas et que gte < lt.
    const range = resolveDateShortcut('today')!;
    expect(range.gte.getTime()).toBeLessThan(range.lt.getTime());
  });
});

describe('parseListQuery — compat legacy ?filter=', () => {
  it('traduit ?filter=field:value dans le même pipeline (whitelist + coercion)', () => {
    const query = parseListQuery(qs('filter=views:42'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ field: 'views', op: 'equals', value: 42 });
  });

  it('un champ sensible via legacy est ignoré (fix de la faille §0.a)', () => {
    const query = parseListQuery(qs('filter=apiToken:abc'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
  });

  it('une valeur incompatible via legacy ne lève jamais (fix §0.b, ex-500 sur Boolean)', () => {
    const query = parseListQuery(qs('filter=published:notabool'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored[0].param).toBe('filter');
  });

  it('published:true via legacy coerce correctement en booléen', () => {
    const query = parseListQuery(qs('filter=published:true'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ field: 'published', value: true });
  });

  it('f.* gagne sur filter= pour le même champ', () => {
    const query = parseListQuery(qs('f.views=1&filter=views:2'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toHaveLength(1);
    expect(query.filters[0].value).toBe(1);
  });

  it('filter= sans deux-points est ignoré silencieusement (pas de crash)', () => {
    const query = parseListQuery(qs('filter=malformed'), Article, schema.enums, [], allFilterable);
    expect(query.filters).toEqual([]);
    expect(query.ignored).toEqual([]);
  });

  it('la valeur legacy peut contenir des deux-points (on coupe sur le premier)', () => {
    const query = parseListQuery(qs('filter=title:10:30'), Article, schema.enums, [], allFilterable);
    expect(query.filters[0]).toMatchObject({ field: 'title', value: '10:30' });
  });
});

describe('buildWhere — composition AND, jamais de spread', () => {
  const empty: ListQuery = { q: null, searchFields: [], filters: [], ignored: [] };

  it('undefined quand rien n\'est actif (identique au comportement actuel)', () => {
    expect(buildWhere(empty, undefined, false)).toBeUndefined();
  });

  it('le scope seul, sans wrapper AND, quand aucun filtre n\'est actif', () => {
    expect(buildWhere(empty, { tenantId: 1 }, false)).toEqual({ tenantId: 1 });
  });

  it('un seul filtre actif sans scope : la clause brute, sans wrapper AND', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'views', op: 'equals', value: 5, raw: '5' }], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toEqual({ views: 5 });
  });

  it('scope + filtre → AND explicite, scope en premier', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'views', op: 'equals', value: 5, raw: '5' }], ignored: [] };
    expect(buildWhere(lq, { tenantId: 1 }, false)).toEqual({
      AND: [{ tenantId: 1 }, { views: 5 }]
    });
  });

  it('un filtre sur le MÊME champ que le scope ne l\'écrase jamais (AND, pas de spread)', () => {
    // C'est le test qui verrouille le fix de la faille §0.c : si le code
    // repassait un jour à `{...scope, ...filterWhere}`, ce test échouerait
    // car le résultat n'aurait qu'une seule clé `tenantId` au lieu des deux
    // entrées indépendantes du AND.
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'tenantId', op: 'equals', value: 2, raw: '2' }], ignored: [] };
    const where = buildWhere(lq, { tenantId: 1 }, false);
    expect(where).toEqual({ AND: [{ tenantId: 1 }, { tenantId: 2 }] });
  });

  it('deux filtres sur le même champ (gte + lte) donnent deux entrées AND, pas un merge', () => {
    const lq: ListQuery = {
      q: null, searchFields: [], ignored: [],
      filters: [
        { field: 'views', op: 'gte', value: 10, raw: '10' },
        { field: 'views', op: 'lte', value: 100, raw: '100' }
      ]
    };
    expect(buildWhere(lq, undefined, false)).toEqual({
      AND: [{ views: { gte: 10 } }, { views: { lte: 100 } }]
    });
  });

  it('isnull=true → {equals: null}', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'content', op: 'isnull', value: true, raw: '1' }], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toEqual({ content: { equals: null } });
  });

  it('isnull=false → {not: null}', () => {
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'content', op: 'isnull', value: false, raw: '0' }], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toEqual({ content: { not: null } });
  });

  it('recherche texte → OR sur les searchFields', () => {
    const lq: ListQuery = { q: 'hello', searchFields: ['title', 'slug'], filters: [], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toEqual({
      OR: [{ title: { contains: 'hello' } }, { slug: { contains: 'hello' } }]
    });
  });

  it('recherche texte avec mode insensible à la casse (Postgres)', () => {
    const lq: ListQuery = { q: 'hello', searchFields: ['title'], filters: [], ignored: [] };
    expect(buildWhere(lq, undefined, true)).toEqual({
      OR: [{ title: { contains: 'hello', mode: 'insensitive' } }]
    });
  });

  it('q présent mais searchFields vide → aucune clause de recherche (no-op, pas {OR: []})', () => {
    const lq: ListQuery = { q: 'hello', searchFields: [], filters: [], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toBeUndefined();
  });

  it('recherche + filtre + scope ensemble → un seul AND cohérent', () => {
    const lq: ListQuery = {
      q: 'hello', searchFields: ['title'],
      filters: [{ field: 'published', op: 'equals', value: true, raw: 'true' }],
      ignored: []
    };
    const where = buildWhere(lq, { tenantId: 1 }, false);
    expect(where).toEqual({
      AND: [
        { tenantId: 1 },
        { published: true },
        { OR: [{ title: { contains: 'hello' } }] }
      ]
    });
  });

  it('date shortcut (gte/lt) se traduit en clause correcte via buildWhere', () => {
    const range = resolveDateShortcut('today', FIXED_NOW)!;
    const lq: ListQuery = { q: null, searchFields: [], filters: [{ field: 'createdAt', op: 'gte', value: range, raw: 'today' }], ignored: [] };
    expect(buildWhere(lq, undefined, false)).toEqual({
      createdAt: { gte: range.gte, lt: range.lt }
    });
  });
});

describe('DEFAULT_LABEL_FIELDS', () => {
  it('contient les candidats attendus, réutilisés depuis les labels de relation', () => {
    expect(DEFAULT_LABEL_FIELDS).toEqual(['name', 'title', 'label', 'email', 'username', 'slug']);
  });
});
