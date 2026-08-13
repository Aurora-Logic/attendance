import { ERROR_CODES } from '@vyuha/shared';

import { AppError } from '../../../platform/common/errors.js';

/**
 * The refusals this slice can produce, and the one Postgres error code the
 * platform helper does not cover.
 *
 * `platform/db/pg-error.ts` recognises `unique_violation` only. The roster's
 * guarantee is an *exclusion* constraint (REQ-C-04, added in migration 0004),
 * which raises a different class-23 code, and reading it here rather than
 * widening the platform helper keeps this slice's failure vocabulary inside
 * the slice.
 */

/** `exclusion_violation`, from the Postgres error code table (class 23). */
const EXCLUSION_VIOLATION = '23P01';

/** How far to follow `cause`; guards against a chain that loops back. */
const MAX_DEPTH = 4;

/**
 * Drizzle wraps a driver failure in an error whose message is the SQL and puts
 * the real one in `cause`, so the code is never on the error that was thrown.
 * Same walk as `pg-error.ts`, for the same reason.
 */
function errorCode(value: unknown): string | null {
  let current: unknown = value;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    if ('code' in current && typeof current.code === 'string') return current.code;
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }
  return null;
}

export function isExclusionViolation(error: unknown): boolean {
  return errorCode(error) === EXCLUSION_VIOLATION;
}

/**
 * REQ-C-04, the answer the client sees.
 *
 * Raised from two places on purpose. The service looks for a clash first so it
 * can name the assignment that is in the way, which a constraint violation
 * cannot; the `catch` around the insert raises the same error for the race the
 * pre-flight check cannot close. One code and one message either way, so the
 * form does not need to tell them apart.
 */
export function rosterOverlapError(
  details: Record<string, unknown>,
  cause?: unknown,
): AppError {
  return new AppError(
    ERROR_CODES.SHIFT_ASSIGNMENT_OVERLAP,
    'That employee already has a shift assignment covering part of this period.',
    { details, ...(cause === undefined ? {} : { cause }) },
  );
}

/**
 * REQ-C-06: "unless the period is locked (then it is rejected with a clear
 * message)". The month is in the message because "the period is locked" sends
 * the reader looking, and the month tells them where.
 */
export function lockedPeriodError(months: readonly string[]): AppError {
  const list = months.join(', ');
  return new AppError(
    ERROR_CODES.PERIOD_LOCKED,
    months.length === 1
      ? `Attendance for ${list} is locked, so the days this roster change would recompute cannot be touched. Ask HR to unlock it first.`
      : `Attendance for ${list} is locked, so the days this roster change would recompute cannot be touched. Ask HR to unlock them first.`,
    { details: { lockedMonths: [...months] } },
  );
}
