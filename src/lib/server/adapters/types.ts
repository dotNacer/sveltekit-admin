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
  op: 'eq' | 'contains' | 'startsWith' | 'gte' | 'lte' | 'lt' | 'in' | 'isNull' | 'isNotNull';
  field: string;
  value?: unknown;
}

import type { Schema, Model } from '../types/schema.js';
import type { RelationEdge } from '../introspection/relations.js';

/** Boot-time schema source. One call per handler lifetime — no per-request cost. */
export interface SchemaIntrospector {
  introspect(): Schema | Promise<Schema>;
}

/**
 * Per-request CRUD + relation-read surface `handler.ts` talks to instead of
 * a raw ORM client. See docs/superpowers/specs/2026-08-13-db-adapter-abstraction-design.md
 * for the rationale behind each method's shape.
 */
export interface DataAdapter {
  /** Vue liste paginée : toujours tri PK desc, toujours count + fetch ensemble. */
  listRecords(
    model: Model,
    opts: { filter?: Filter; skip: number; take: number }
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
    }
  ): Promise<Record<string, unknown>>;

  updateRecord(
    model: Model,
    id: string | number,
    input: {
      scalars: Record<string, unknown>;
      m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
    }
  ): Promise<Record<string, unknown>>;

  deleteRecord(model: Model, id: string | number): Promise<void>;

  /** `targetModel` est fourni par l'appelant : chaque site d'appel actuel l'a déjà résolu. */
  getM2mSelectedIds(
    model: Model,
    edge: RelationEdge,
    targetModel: Model,
    recordId: string | number
  ): Promise<Array<string | number>>;
}
