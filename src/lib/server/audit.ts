/**
 * Audit-log helpers for successful admin writes.
 *
 * The package has no session store and no first-party AuditLog table — same
 * bring-your-own philosophy as `authCheck` / `logout`. This module builds a
 * redacted `AuditEvent` and emits it to the consumer's callback. Sensitive
 * names (`isSensitiveFieldName`) and config `hidden` fields are stripped from
 * every snapshot so the audit sink cannot become a second oracle for secrets.
 */

import { isSensitiveFieldName } from './introspection/parser.js';
import type { Model } from './types/schema.js';

export type AuditAction = 'create' | 'update' | 'delete';

export type AuditEvent =
  | {
      event: any;
      at: Date;
      action: 'create';
      model: string;
      id: string | number;
      values: Record<string, unknown>;
      after: Record<string, unknown>;
      m2m?: Record<string, Array<string | number>>;
    }
  | {
      event: any;
      at: Date;
      action: 'update';
      model: string;
      id: string | number;
      values: Record<string, unknown>;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
      changes: Record<string, { from: unknown; to: unknown }>;
      m2m?: Record<string, Array<string | number>>;
    }
  | {
      event: any;
      at: Date;
      action: 'delete';
      model: string;
      id: string | number;
      before: Record<string, unknown> | null;
    };

export function redactForAudit(
  record: Record<string, unknown>,
  model: Model,
  hidden: ReadonlySet<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of model.fields) {
    if (field.relation || field.isList) continue;
    if (isSensitiveFieldName(field.name) || hidden.has(field.name)) continue;
    if (!(field.name in record)) continue;
    out[field.name] = record[field.name];
  }
  return out;
}

function auditValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'bigint' && typeof b === 'bigint') return a === b;
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (!auditValuesEqual(from, to)) {
      changes[key] = { from, to };
    }
  }
  return changes;
}

function compactM2m(
  m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>
): Record<string, Array<string | number>> | undefined {
  if (!m2m) return undefined;
  const keys = Object.keys(m2m);
  if (keys.length === 0) return undefined;
  const out: Record<string, Array<string | number>> = {};
  for (const key of keys) {
    out[key] = m2m[key].ids;
  }
  return out;
}

export interface BuildAuditEventInput {
  event: any;
  at?: Date;
  action: AuditAction;
  model: Model;
  id: string | number;
  hidden: ReadonlySet<string>;
  values?: Record<string, unknown>;
  m2m?: Record<string, { targetPkField: string; ids: Array<string | number> }>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown>;
}

export function buildAuditEvent(input: BuildAuditEventInput): AuditEvent {
  const at = input.at ?? new Date();
  const hidden = input.hidden;
  const m2m = compactM2m(input.m2m);
  const base = { event: input.event, at, model: input.model.name, id: input.id };

  if (input.action === 'delete') {
    const before = input.before ? redactForAudit(input.before, input.model, hidden) : null;
    return { ...base, action: 'delete', before };
  }

  const values = redactForAudit(input.values ?? {}, input.model, hidden);

  if (input.action === 'create') {
    const after = redactForAudit(input.after ?? {}, input.model, hidden);
    return m2m
      ? { ...base, action: 'create', values, after, m2m }
      : { ...base, action: 'create', values, after };
  }

  const afterRaw = { ...(input.before ?? {}), ...(input.after ?? {}) };
  const after = redactForAudit(afterRaw, input.model, hidden);
  const before = input.before ? redactForAudit(input.before, input.model, hidden) : null;
  const changes = before ? diffRecords(before, after) : {};
  return m2m
    ? { ...base, action: 'update', values, before, after, changes, m2m }
    : { ...base, action: 'update', values, before, after, changes };
}

export async function readAuditSnapshot(
  getRecord: (model: Model, id: string | number) => Promise<Record<string, unknown> | null>,
  model: Model,
  id: string | number
): Promise<Record<string, unknown> | null> {
  try {
    return await getRecord(model, id);
  } catch {
    return null;
  }
}

export async function emitAudit(
  audit: ((entry: AuditEvent) => void | Promise<void>) | undefined,
  entry: AuditEvent
): Promise<void> {
  if (!audit) return;
  try {
    await audit(entry);
  } catch (e) {
    console.error('[sveltekit-admin] audit callback failed:', e);
  }
}
