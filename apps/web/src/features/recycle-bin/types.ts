import { SOFT_DELETABLE_ENTITIES, type SoftDeletableEntity } from '@vyuha/shared';
import { z } from 'zod';

/**
 * `GET /recycle-bin` and `POST /masters/:entityType/:id/restore` (REQ-B-09a).
 *
 * Parsed rather than trusted. The bin is the one screen whose whole job is to
 * describe records that are not in any other list, so a shape mismatch here has
 * no second source to be caught against — it would render as blank cells and
 * read as "nothing was deleted", which is the worst possible lie for this
 * screen to tell.
 */

const actorSchema = z.object({ id: z.string(), name: z.string().nullable() });

export const recycleBinEntrySchema = z.object({
  entityType: z.enum(SOFT_DELETABLE_ENTITIES),
  entityLabel: z.string(),
  id: z.string(),
  name: z.string(),
  /** Null for a record with no code of its own: a holiday calendar, a role. */
  code: z.string().nullable(),
  deletedAt: z.string(),
  /**
   * Null for a row soft-deleted by a path that wrote no deletion record — an
   * older migration, a repair script. It still belongs in the bin; it just
   * cannot say who or why.
   */
  deletedBy: actorSchema.nullable(),
  reason: z.string().nullable(),
});

export type RecycleBinEntry = z.infer<typeof recycleBinEntrySchema>;

export const recycleBinResponseSchema = z.object({
  data: z.array(recycleBinEntrySchema),
  meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
});

export type RecycleBinResponse = z.infer<typeof recycleBinResponseSchema>;

/**
 * The permission each record type needs, mirrored from the server registry.
 *
 * Used only to explain a refusal before it happens — the server re-checks every
 * one of these and is the authority. Keeping the map here rather than deriving
 * it from the response means the screen can say "this needs settings.manage"
 * next to a row it will not let you restore, instead of letting you press and
 * reading you the 403.
 */
export const ENTITY_PERMISSION: Record<SoftDeletableEntity, string> = {
  department: 'employee.manage',
  designation: 'employee.manage',
  location: 'settings.manage',
  shift: 'shift.manage',
  leaveType: 'leave.policy.manage',
  holidayCalendar: 'holiday.manage',
  role: 'roles.manage',
};

/** Plural, for the filter chips. Sentence case, matching the server's labels. */
export const ENTITY_LABELS: Record<SoftDeletableEntity, string> = {
  department: 'Departments',
  designation: 'Designations',
  location: 'Locations',
  shift: 'Shifts',
  leaveType: 'Leave types',
  holidayCalendar: 'Holiday calendars',
  role: 'Roles',
};
