/**
 * Relation graph builder.
 *
 * Passe de post-traitement sur l'AST brut du parser : apparie les champs
 * relation par clé (modelA, modelB, relationName), classifie chaque arête,
 * et produit les maps de lien entre scalaires FK et relations.
 *
 * Référence design : docs/design/relations.md §1.
 *
 * Règle d'or : ne JAMAIS apparier deux champs relation par « ils pointent
 * vers le même modèle » — `Post { author User, reviewer User }` produirait
 * un appariement aléatoire et silencieusement faux. L'appariement se fait
 * par nom de relation, que Prisma garantit unique pour un couple de modèles.
 */

import type { PrismaField, PrismaModel, PrismaSchema } from './parser.js';

export type RelationKind =
  | 'to-one-owning'
  | 'to-one-inverse'
  | 'to-many-inverse'
  | 'm2m-implicit';

export type UnsupportedReason = 'composite-fk' | 'ambiguous';

export interface RelationEdge {
  /** Modèle porteur du champ */
  model: string;
  /** Nom du champ relation */
  field: string;
  kind: RelationKind;
  /** Modèle cible */
  target: string;
  /** Nom de relation (@relation("...")), chaîne vide si absent */
  relationName: string;
  isRequired: boolean;
  isList: boolean;
  /** Noms des scalaires FK portés par ce champ (vide si non owning) */
  scalarFields: string[];
  selfReferential: boolean;
  /** false quand la back-reference n'existe pas dans le schéma */
  hasBackReference: boolean;
  unsupported?: UnsupportedReason;
}

export interface RelationGraph {
  /** Arêtes indexées par "Model.field" */
  edges: Map<string, RelationEdge>;
  /** "authorId" → "author" (nom du champ relation owning) */
  scalarToRelation: Map<string, string>;
  /** "Post.author" → ["authorId"] */
  relationToScalars: Map<string, string[]>;
  /** Diagnostics non bloquants (groupes ambigus, etc.) */
  diagnostics: string[];
}

const key = (model: string, field: string) => `${model}.${field}`;

/**
 * Clé d'appariement normalisée : les deux noms de modèle triés + le nom de
 * relation. Triés parce que l'arête owning et l'arête inverse déclarent le
 * même couple dans l'ordre inverse. Les relations self-referential ont
 * naturellement (A, A, name).
 */
function pairKey(modelA: string, modelB: string, relationName: string): string {
  const [lo, hi] = [modelA, modelB].sort();
  return `${lo}|${hi}|${relationName}`;
}

interface Candidate {
  model: string;
  field: PrismaField;
  relationName: string;
}

export function buildRelationGraph(schema: PrismaSchema): RelationGraph {
  const modelNames = new Set(schema.models.map((m) => m.name));
  const edges = new Map<string, RelationEdge>();
  const scalarToRelation = new Map<string, string>();
  const relationToScalars = new Map<string, string[]>();
  const diagnostics: string[] = [];

  // 1. Collecter les champs dont le type est un nom de modèle.
  const candidates: Candidate[] = [];
  for (const model of schema.models) {
    for (const field of model.fields) {
      if (!field.relation || !modelNames.has(field.relation.model)) continue;
      candidates.push({
        model: model.name,
        field,
        relationName: field.relation.name ?? ''
      });
    }
  }

  // 2. Grouper par clé d'appariement.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const pk = pairKey(c.model, c.field.relation!.model, c.relationName);
    const group = groups.get(pk) ?? [];
    group.push(c);
    groups.set(pk, group);
  }

  // 3. Classifier chaque groupe.
  for (const [, group] of groups) {
    if (group.length > 2) {
      // Schéma invalide ou bug d'appariement : ne pas deviner. On marque
      // toutes les arêtes du groupe comme ambiguës et on passe à la suite.
      diagnostics.push(
        `Ambiguous relation group (${group.map((c) => key(c.model, c.field.name)).join(', ')}) — editing disabled`
      );
      for (const c of group) {
        edges.set(key(c.model, c.field.name), makeEdge(c, {
          kind: 'to-one-owning',
          hasBackReference: true,
          unsupported: 'ambiguous'
        }));
      }
      continue;
    }

    const owning = group.filter(
      (c) => !c.field.isList && (c.field.relation!.fields?.length ?? 0) > 0
    );

    // N-N implicite : groupe de 2, list des deux côtés, aucun fields.
    const [a, b] = group;
    const isImplicitM2M =
      group.length === 2 && a.field.isList && b.field.isList
        ? !a.field.relation!.fields?.length && !b.field.relation!.fields?.length
        : false;

    for (const c of group) {
      let kind: RelationKind;
      if (isImplicitM2M) {
        kind = 'm2m-implicit';
      } else if (c.field.isList) {
        kind = 'to-many-inverse';
      } else if (owning.includes(c)) {
        kind = 'to-one-owning';
      } else {
        kind = 'to-one-inverse';
      }

      const hasBackReference = group.length === 2;
      const owningFields = c.field.relation!.fields;
      const edge = makeEdge(c, { kind, hasBackReference });

      // FK composite : un <option value> ne peut pas porter un tuple.
      if (kind === 'to-one-owning' && owningFields && owningFields.length > 1) {
        edge.unsupported = 'composite-fk';
        diagnostics.push(
          `Composite FK on ${key(c.model, c.field.name)} — editing disabled, use raw-id`
        );
      }

      edges.set(key(c.model, c.field.name), edge);

      // 4. Lien scalaires FK ↔ relation owning.
      if (kind === 'to-one-owning' && owningFields) {
        relationToScalars.set(key(c.model, c.field.name), owningFields);
        for (const s of owningFields) {
          scalarToRelation.set(s, c.field.name);
        }
      }
    }
  }

  return { edges, scalarToRelation, relationToScalars, diagnostics };
}

function makeEdge(
  c: Candidate,
  opts: { kind: RelationKind; hasBackReference: boolean; unsupported?: UnsupportedReason }
): RelationEdge {
  return {
    model: c.model,
    field: c.field.name,
    kind: opts.kind,
    target: c.field.relation!.model,
    relationName: c.relationName,
    isRequired: c.field.isRequired,
    isList: c.field.isList,
    scalarFields: c.field.relation!.fields ?? [],
    selfReferential: c.model === c.field.relation!.model,
    hasBackReference: opts.hasBackReference,
    unsupported: opts.unsupported
  };
}

/** Raccourci : arêtes d'un modèle donné, dans l'ordre déclaré du schéma. */
export function relationsOf(model: PrismaModel, graph: RelationGraph): RelationEdge[] {
  return model.fields
    .filter((f) => graph.edges.has(`${model.name}.${f.name}`))
    .map((f) => graph.edges.get(`${model.name}.${f.name}`)!);
}
