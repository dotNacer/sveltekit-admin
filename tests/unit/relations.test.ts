import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSchemaContent } from '../../src/lib/server/introspection/parser.js';
import {
  buildRelationGraph,
  relationsOf,
  type RelationGraph
} from '../../src/lib/server/introspection/relations.js';

const here = dirname(fileURLToPath(import.meta.url));
const RELATIONS_SCHEMA_PATH = join(here, '../fixtures/schemas/relations.prisma');

const schema = parseSchemaContent(readFileSync(RELATIONS_SCHEMA_PATH, 'utf-8'));
const graph = buildRelationGraph(schema);
const model = (name: string) => schema.models.find((m) => m.name === name)!;
const edge = (g: RelationGraph, k: string) => g.edges.get(k);

describe('buildRelationGraph — classification', () => {
  it('classifie une FK required comme to-one-owning', () => {
    const e = edge(graph, 'Post.author')!;
    expect(e.kind).toBe('to-one-owning');
    expect(e.target).toBe('User');
    expect(e.relationName).toBe('AuthorPosts');
    expect(e.isRequired).toBe(true);
    expect(e.scalarFields).toEqual(['authorId']);
    expect(e.hasBackReference).toBe(true);
  });

  it('classifie une FK optionnelle comme to-one-owning isRequired=false', () => {
    const e = edge(graph, 'Post.reviewer')!;
    expect(e.kind).toBe('to-one-owning');
    expect(e.isRequired).toBe(false);
    expect(e.scalarFields).toEqual(['reviewerId']);
  });

  it('classifie le côté liste comme to-many-inverse', () => {
    const e = edge(graph, 'User.posts')!;
    expect(e.kind).toBe('to-many-inverse');
    expect(e.relationName).toBe('AuthorPosts');
    expect(e.scalarFields).toEqual([]);
  });

  it('apparie par nom de relation, pas par type : author ≠ reviewer', () => {
    // Deux relations nommées Post→User : l\'appariement naïf par type
    // échouerait ici. Chaque arête owning doit pointer vers SA liste inverse.
    expect(edge(graph, 'User.posts')!.relationName).toBe('AuthorPosts');
    expect(edge(graph, 'User.reviews')!.relationName).toBe('ReviewerPosts');
    expect(graph.scalarToRelation.get('authorId')).toBe('author');
    expect(graph.scalarToRelation.get('reviewerId')).toBe('reviewer');
  });

  it('détecte le N-N implicite (list des deux côtés, sans fields)', () => {
    expect(edge(graph, 'Post.tags')!.kind).toBe('m2m-implicit');
    expect(edge(graph, 'Tag.posts')!.kind).toBe('m2m-implicit');
  });

  it('détecte le 1-1 : owning + inverse sans liste', () => {
    expect(edge(graph, 'Profile.user')!.kind).toBe('to-one-owning');
    expect(edge(graph, 'User.profile')!.kind).toBe('to-one-inverse');
  });

  it('marque les relations self-referential', () => {
    const s = parseSchemaContent(`
      model Category {
        id       Int        @id
        parentId Int?
        parent   Category?  @relation("Tree", fields: [parentId], references: [id])
        children Category[] @relation("Tree")
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'Category.parent')!.selfReferential).toBe(true);
    expect(edge(g, 'Category.children')!.selfReferential).toBe(true);
    expect(edge(g, 'Category.parent')!.kind).toBe('to-one-owning');
    expect(edge(g, 'Category.children')!.kind).toBe('to-many-inverse');
  });

  it('marque les FK composites comme unsupported', () => {
    const e = edge(graph, 'Line.order')!;
    expect(e.kind).toBe('to-one-owning');
    expect(e.unsupported).toBe('composite-fk');
    expect(e.scalarFields).toEqual(['orderA', 'orderB']);
    expect(graph.diagnostics.some((d) => d.includes('Composite FK'))).toBe(true);
  });

  it('gère les relations unidirectionnelles (hasBackReference=false)', () => {
    const e = edge(graph, 'AuditLog.actor')!;
    expect(e.kind).toBe('to-one-owning');
    expect(e.hasBackReference).toBe(false);
  });
});

describe('buildRelationGraph — maps scalaires', () => {
  it('relationToScalars indexe les FK de chaque relation owning', () => {
    expect(graph.relationToScalars.get('Post.author')).toEqual(['authorId']);
    expect(graph.relationToScalars.get('Profile.user')).toEqual(['userId']);
  });

  it('scalarToRelation ne contient pas les champs non-FK', () => {
    expect(graph.scalarToRelation.has('email')).toBe(false);
    expect(graph.scalarToRelation.has('title')).toBe(false);
  });
});

describe('relationsOf', () => {
  it('retourne les arêtes d\'un modèle dans l\'ordre du schéma', () => {
    const edges = relationsOf(model('Post'), graph);
    expect(edges.map((e) => e.field)).toEqual(['author', 'reviewer', 'tags', 'labels']);
  });

  it('retourne un tableau vide pour un modèle sans relation', () => {
    // Tag n\'a que m2m-implicit, vérifions avec un modèle minimal
    const minimal = parseSchemaContent('model A { id Int @id }');
    const g = buildRelationGraph(minimal);
    expect(relationsOf(minimal.models[0], g)).toEqual([]);
  });
});

describe('buildRelationGraph — robustesse', () => {
  it('ignore les champs scalaires et les enums', () => {
    const s = parseSchemaContent(`
      enum Role { USER ADMIN }
      model A { id Int @id role Role @default(USER) }
    `);
    const g = buildRelationGraph(s);
    expect(g.edges.size).toBe(0);
  });

  it('n\'apparie pas un champ dont le type n\'est pas un modèle connu', () => {
    const s = parseSchemaContent(`
      model A { id Int @id b B }
    `);
    const g = buildRelationGraph(s);
    // B n\'existe pas : pas d\'arête, pas de crash.
    expect(g.edges.size).toBe(0);
  });

  it('classe une liste orpheline (sans owning en face) en to-many-inverse', () => {
    const s = parseSchemaContent(`
      model A {
        id Int @id
        bs B[]
      }
      model B {
        id Int @id
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'A.bs')!.kind).toBe('to-many-inverse');
    expect(edge(g, 'A.bs')!.hasBackReference).toBe(false);
  });

  it('ne classe pas m2m un groupe mixte liste + owning', () => {
    // Un côté list, l\'autre owning : c\'est du 1-N, pas du N-N.
    const g = buildRelationGraph(schema);
    expect(edge(g, 'Post.author')!.kind).toBe('to-one-owning');
    expect(edge(g, 'User.posts')!.kind).toBe('to-many-inverse');
  });

  it('ne classe pas m2m un groupe où le second champ porte la FK', () => {
    const s = parseSchemaContent(`
      model A {
        id Int @id
        bs B[]
      }
      model B {
        id  Int @id
        aId Int
        a   A   @relation(fields: [aId], references: [id])
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'A.bs')!.kind).toBe('to-many-inverse');
    expect(edge(g, 'B.a')!.kind).toBe('to-one-owning');
  });

  it('tolère une relation owning sans fields (défaut Prisma implicite)', () => {
    const s = parseSchemaContent(`
      model A {
        id Int @id
        b  B   @relation("R")
      }
      model B {
        id Int @id
        as A[] @relation("R")
      }
    `);
    const g = buildRelationGraph(s);
    // Pas de fields : pas owning, c\'est un to-one-inverse.
    expect(edge(g, 'A.b')!.kind).toBe('to-one-inverse');
  });

  it('ne classe pas m2m un groupe où une liste porte quand même des fields', () => {
    // Cas pathologique (invalide côté Prisma réel, mais le parser maison ne
    // le rejette pas) : une liste porteuse de `fields`. Ça doit rester en
    // dehors du N-N implicite — les deux côtés doivent être sans FK.
    const s = parseSchemaContent(`
      model A {
        id      Int @id
        dummyId Int
        bs      B[] @relation(fields: [dummyId], references: [id])
      }
      model B {
        id Int @id
        as A[]
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'A.bs')!.kind).not.toBe('m2m-implicit');
  });

  it('ne classe pas m2m quand seul le second champ liste porte des fields', () => {
    const s = parseSchemaContent(`
      model A {
        id Int @id
        bs B[]
      }
      model B {
        id      Int @id
        dummyId Int
        as      A[] @relation(fields: [dummyId], references: [id])
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'A.bs')!.kind).not.toBe('m2m-implicit');
    expect(edge(g, 'B.as')!.kind).not.toBe('m2m-implicit');
  });

  it('diagnostique les groupes ambigus (3+ champs) sans deviner', () => {
    // Cas pathologique : un owning + deux listes sous le même nom de relation.
    // Prisma le rejetterait ; si le schéma passe quand même (parser maison),
    // le graphe doit émettre un diagnostic plutôt que d\'apparier au hasard.
    const s = parseSchemaContent(`
      model A {
        id  Int @id
        bId Int
        x   B   @relation("R", fields: [bId], references: [id])
      }
      model B {
        id Int @id
        a1 A[] @relation("R")
        a2 A[] @relation("R")
      }
    `);
    const g = buildRelationGraph(s);
    expect(edge(g, 'A.x')!.unsupported).toBe('ambiguous');
    expect(edge(g, 'B.a1')!.unsupported).toBe('ambiguous');
    expect(edge(g, 'B.a2')!.unsupported).toBe('ambiguous');
    expect(g.diagnostics.some((d) => d.includes('Ambiguous'))).toBe(true);
  });
});
