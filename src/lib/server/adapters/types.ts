/**
 * ORM-agnostic where-clause AST. `listQuery.ts#buildWhere` produces this;
 * each adapter's own `filterCompiler` (see `adapters/prisma/filterCompiler.ts`)
 * turns it into that ORM's native query shape. Never expose an ORM-specific
 * operator here (no `mode: 'insensitive'`, no Prisma `not`) — those are
 * compiler-side decisions made from `LeafFilter.op`, not carried in the AST.
 */
export type Filter = CompositeFilter | LeafFilter;

export interface CompositeFilter {
  op: 'and' | 'or';
  clauses: Filter[];
}

export interface LeafFilter {
  op: 'eq' | 'contains' | 'containsExact' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull';
  field: string;
  value?: unknown;
}

import type { Schema, Model } from '../types/schema.js';
import type { RelationEdge } from '../introspection/relations.js';

/** Boot-time schema source. One call per handler lifetime — no per-request cost. */
export interface SchemaIntrospector {
  introspect(): Schema | Promise<Schema>;
}

export interface TargetGuard {
  targetModel: Model;
  targetPk: string | number;
  filter?: Filter;
}

/** Tri demandé par `?sort=`, déjà validé contre les colonnes que la vue rend. */
export interface ListOrder {
  field: string;
  dir: 'asc' | 'desc';
}

/**
 * Per-request CRUD + relation-read surface `handler.ts` talks to instead of
 * a raw ORM client. See docs/superpowers/specs/2026-08-13-db-adapter-abstraction-design.md
 * for the rationale behind each method's shape.
 */
export interface DataAdapter {
  /**
   * Vue liste paginée : toujours count + fetch ensemble.
   *
   * `orderBy` absent = clé primaire décroissante, l'ordre historique. Présent,
   * il est TOUJOURS départagé par la clé primaire décroissante, sauf quand
   * c'est elle qu'on trie : sans ce départage, deux lignes de même valeur
   * peuvent changer de page d'une requête à l'autre, et une fenêtre
   * `skip`/`take` posée par-dessus perd son sens (une ligne vue deux fois, une
   * autre jamais). C'est à l'adapter de le composer — lui seul sait nommer la
   * clé primaire dans le langage de son moteur.
   *
   * `field` n'est jamais une chaîne libre : `sortQuery.ts` ne le laisse sortir
   * que s'il appartient aux colonnes réellement rendues par la liste.
   */
  listRecords(
    model: Model,
    opts: { filter?: Filter; skip: number; take: number; orderBy?: ListOrder }
  ): Promise<{ rows: Record<string, unknown>[]; total: number }>;

  /**
   * Lecture générale sans pagination forcée : options de relation FK/m2m,
   * options de filtre FK sidebar, endpoint `_search`. `orderBy` est le
   * `Record<string, 'asc' | 'desc'>` déjà exposé tel quel côté config
   * publique (`AdminHandlerConfig.models[].relations[field].orderBy`) —
   * transmis de façon opaque, sans traduction.
   */
  findMany(
    model: Model,
    opts: { filter?: Filter; orderBy?: Record<string, 'asc' | 'desc'>; skip?: number; take?: number }
  ): Promise<Record<string, unknown>[]>;

  getRecord(model: Model, id: string | number): Promise<Record<string, unknown> | null>;

  findFirst(model: Model, filter: Filter): Promise<Record<string, unknown> | null>;

  countRecords(model: Model, filter?: Filter): Promise<number>;

  /**
   * `m2m`'s value carries the TARGET model's PK field name alongside the raw
   * ids, not just the ids: this adapter has no `Schema`/`RelationGraph` of
   * its own to resolve a target model from an edge, and `handler.ts` (the
   * only caller) already resolves the target model before building this
   * payload, at zero extra cost to it.
   */
  createRecord(
    model: Model,
    input: {
      scalars: Record<string, unknown>;
      m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
      targetGuards?: TargetGuard[];
    }
  ): Promise<Record<string, unknown>>;

  updateRecord(
    model: Model,
    id: string | number,
    input: {
      scalars: Record<string, unknown>;
      m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
      targetGuards?: TargetGuard[];
    },
    authorizationFilter?: Filter
  ): Promise<Record<string, unknown>>;

  deleteRecord(model: Model, id: string | number, authorizationFilter?: Filter): Promise<void>;

  /** `targetModel` est fourni par l'appelant : chaque site d'appel actuel l'a déjà résolu. */
  getM2mSelectedIds(
    model: Model,
    edge: RelationEdge,
    targetModel: Model,
    recordId: string | number
  ): Promise<Array<string | number>>;
}
