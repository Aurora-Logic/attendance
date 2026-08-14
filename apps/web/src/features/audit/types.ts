import { z } from 'zod';

/**
 * `GET /audit-logs` (REQ-M-01, REQ-M-02), as the viewer reads it.
 *
 * `before` and `after` are `unknown` on purpose. The trail records whatever the
 * entity that changed looked like, so its shape differs per row and per version
 * of that entity -- a schema here would either be useless or would start
 * rejecting historical rows the moment an entity gained a field.
 */

const actorSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});

export type AuditActor = z.infer<typeof actorSchema>;

export const auditEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actor: actorSchema.nullable(),
  /** Set when an administrator was acting as somebody else (REQ-M-01). */
  impersonator: actorSchema.nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  data: z.array(auditEntrySchema),
  meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

export type AuditPage = z.infer<typeof auditPageSchema>;

export const auditFacetsSchema = z.object({
  actions: z.array(z.string()),
  entityTypes: z.array(z.string()),
});

export type AuditFacets = z.infer<typeof auditFacetsSchema>;

export interface AuditFilters {
  action: string | null;
  entityType: string | null;
  /**
   * REQ-M-02's second half: "per-record history on employee, attendance day,
   * leave, and settings screens".
   *
   * `GET /audit-logs` has accepted this since the endpoint was written and no
   * screen sent it, so the trail could be read as a whole and never as the
   * story of one record. The viewer never sets it; `RecordHistorySheet` does.
   */
  entityId: string | null;
  /** Date-only `YYYY-MM-DD`; widened to whole days before it is sent. */
  from: string | null;
  to: string | null;
}

export const EMPTY_FILTERS: AuditFilters = {
  action: null,
  entityType: null,
  entityId: null,
  from: null,
  to: null,
};

/**
 * `department.created` -> `Department created`.
 *
 * The trail also holds route-derived actions like `POST punches`, which have no
 * dot and are left as they are: inventing a prettier name for them would hide
 * the fact that the service did not name its own action.
 */
export function humaniseAction(action: string): string {
  if (!action.includes('.')) return action;
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The changed fields in a diff, as label/value pairs the sheet can list.
 *
 * `AuditService.diffJson` has already narrowed before/after to what moved, so
 * this only has to render it. A value that is not a primitive is stringified
 * rather than skipped: an object that changed is still a change, and a row that
 * silently showed nothing would read as a change of nothing.
 */
export interface DiffRow {
  field: string;
  before: string;
  after: string;
}

const ABSENT = '—';

function printValue(value: unknown): string {
  if (value === undefined) return ABSENT;
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length === 0 ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function diffRows(before: unknown, after: unknown): DiffRow[] {
  const left = asRecord(before);
  const right = asRecord(after);

  if (left === null && right === null) {
    if (before === null && after === null) return [];
    return [{ field: 'value', before: printValue(before), after: printValue(after) }];
  }

  const fields = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
  return fields.map((field) => ({
    field,
    before: printValue(left?.[field]),
    after: printValue(right?.[field]),
  }));
}
