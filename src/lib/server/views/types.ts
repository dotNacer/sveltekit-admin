import type { PrismaField } from '../introspection/parser.js';
import type { RelationGraph } from '../introspection/relations.js';

export interface RelationOption {
  id: string | number;
  label: string;
}

export interface RelationMeta {
  /** true si la cible dépasse le seuil dur — rendre un raw-id, pas un select */
  tooMany: boolean;
  options: RelationOption[];
}

export interface ViewModel {
  name: string;
  label: string;
  fields: PrismaField[];
  primaryKey: string;
  relationGraph?: RelationGraph;
  /** Options résolues pour chaque arête to-one-owning, indexées par "Model.field" */
  relationOptions?: Map<string, RelationMeta>;
}
