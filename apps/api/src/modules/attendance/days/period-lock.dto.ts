import { ATTENDANCE_STATUSES, adminReasonSchema, reasonBodySchema } from '@vyuha/shared';
import { z } from 'zod';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * REQ-E-09 and REQ-E-08 request bodies.
 *
 * Defined here rather than in `@vyuha/shared` because the shared package's
 * attendance contract is owned by another slice; the web feature mirrors these
 * shapes in `features/period-lock/types.ts`. The reason field itself does come
 * from the shared package, so the minimum length cannot drift between what the
 * dialog enforces and what the server does.
 */

/**
 * A year bounded on both sides. Not because 1999 is impossible, but because a
 * typo — 202 or 20226 — should be refused at the edge rather than create a lock
 * row nobody can find and nothing can unlock.
 */
const yearField = z.coerce.number().int().min(2000).max(2100);
const monthField = z.coerce.number().int().min(1).max(12);

export const lockPeriodSchema = z.object({
  year: yearField,
  month: monthField,
  /** Null is an organisation-wide lock, which covers employees with no location. */
  locationId: z.uuid().nullish(),
  reason: adminReasonSchema,
});

export type LockPeriodInput = z.infer<typeof lockPeriodSchema>;

export const periodLockQuerySchema = z.object({
  year: yearField.optional(),
  /** Live locks only. Absent shows the history as well, which is what audits it. */
  liveOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type PeriodLockQuery = z.infer<typeof periodLockQuerySchema>;

/**
 * REQ-E-08. `status` absent means "lift the override": the day goes back to
 * whatever the engine computes, and the reason explains why the human decision
 * was withdrawn.
 */
export const overrideDaySchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES).nullish(),
  reason: adminReasonSchema,
});

export type OverrideDayInput = z.infer<typeof overrideDaySchema>;

export class LockPeriodDto extends createZodDto(lockPeriodSchema) {}
export class PeriodLockQueryDto extends createZodDto(periodLockQuerySchema) {}
export class UnlockPeriodDto extends createZodDto(reasonBodySchema) {}
export class OverrideDayDto extends createZodDto(overrideDaySchema) {}
