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
  /** N-N uniquement : IDs actuellement liés (absent en création) */
  selectedIds?: (string | number)[];
}

export interface ViewModel {
  name: string;
  label: string;
  singularLabel?: string;
  pluralLabel?: string;
  fields: PrismaField[];
  primaryKey: string;
  /**
   * Valeurs déclarées de chaque enum du schéma, indexées par nom de type.
   * Portées par le ViewModel plutôt que passées à part comme le fait
   * `filterDetection` : le formulaire résout un enum champ par champ, et un
   * second chemin d'acheminement vers les mêmes valeurs finirait par diverger.
   */
  enums?: Map<string, string[]>;
  relationGraph?: RelationGraph;
  /** Options résolues pour chaque arête to-one-owning, indexées par "Model.field" */
  relationOptions?: Map<string, RelationMeta>;
  /** Compteurs des relations inverses (1-N, 1-1), indexés par "Model.field" */
  relatedCounts?: Map<string, number>;
}

export interface RecordAction {
  label: string;
  href: string;
}

export interface ListRecordAction {
  label: string;
  hrefFor: (id: string | number) => string;
}

/**
 * Résolution async d'un filtre FK (kind 'fk' dans ResolvedFilterField) :
 * options scopées pour la sidebar + label du chip actif scopé lui aussi
 * (docs/design/list-search-filters.md §6.3). Chargé par requête, jamais
 * auto-détecté (contrairement à Boolean/enum dont le domaine est statique).
 */
export interface FkFilterMeta {
  /** Nom du scalaire FK, ex: `authorId`. */
  field: string;
  label: string;
  /** Nom du champ relation owning, ex: `author`. */
  relationField: string;
  /** Nom du modèle cible, ex: `User`. */
  targetModel: string;
  /** Options résolues et scopées (vide si tooMany). */
  options: RelationOption[];
  /** Décision de rendu par cardinalité : liens ≤ 20, select ≤ 200, raw-id au-delà. */
  mode: 'links' | 'select' | 'raw-id';
  /** true si la cible dépasse selectThreshold : rendre un raw-id, pas une liste. */
  tooMany: boolean;
  /**
   * Label du chip actif, résolu via findFirst SCOPÉ (§6.3.b) — undefined
   * si l'ID actif est hors scope (le composant affiche alors l'ID brut,
   * jamais le label, sinon c'est un oracle inter-tenants).
   */
  activeLabel?: string;
  /**
   * Lien vers la fiche de la cible pour le chip actif, seulement si le modèle
   * cible est visible dans l'admin. Absent pour une cible exclue/masquée :
   * aucun lien mort vers une page inaccessible (§6.4).
   */
  activeHref?: string;
}
