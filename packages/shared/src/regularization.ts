import { z } from 'zod';

import { APPROVAL_STATUSES, type ApprovalStatus } from './enums.js';
import { pageQuerySchema } from './pagination.js';
import type { NamedRef } from './people.js';

/**
 * Regularization and on-duty (REQ-F-01 … REQ-F-05).
 *
 * Here rather than in either app for the reason every other contract in this
 * package gives: the server parses requests with these schemas and the web
 * client builds its forms against the same types, so a field one end sends and
 * the other silently discards cannot happen.
 *
 * **Times are wall clock, not instants.** A person correcting a forgotten OUT
 * punch says "I left at 18:30", and they mean 18:30 where they were standing.
 * Sending an instant would make the client responsible for the employee's
 * location timezone, which it does not know and must not guess -- the server
 * composes the instant with `AT TIME ZONE`, exactly as it does for a shift's
 * scheduled start (technical design §5, step 1). The consequence worth
 * stating: this contract carries `HH:mm` and nothing else, so a client cannot
 * express "18:30 in a zone of my choosing", which is the bug this shape exists
 * to prevent.
 */

// ------------------------------------------------------------------- kinds

/** REQ-F-01's four causes. Matches the `regularization_kind` enum in 0004. */
export const REGULARIZATION_KINDS = [
  'MISSING_IN',
  'MISSING_OUT',
  'WRONG_TIME',
  'FORGOT_TO_PUNCH',
] as const;

export type RegularizationKind = (typeof REGULARIZATION_KINDS)[number];

/**
 * Who raised the request. `SYSTEM` is the auto-file setting's doing: the day
 * engine drops a draft into the employee's own queue when a punch is `late`
 * or `outside_window`, with no reason yet, and nobody but that employee can
 * see it until they supply one and it becomes an ordinary request an
 * approver decides.
 */
export const REGULARIZATION_ORIGINS = ['EMPLOYEE', 'SYSTEM'] as const;

export type RegularizationOrigin = (typeof REGULARIZATION_ORIGINS)[number];

/** Exported so the form and the table name a kind the same way. */
export const REGULARIZATION_KIND_LABELS: Record<RegularizationKind, string> = {
  MISSING_IN: 'Missing in punch',
  MISSING_OUT: 'Missing out punch',
  WRONG_TIME: 'Wrong time recorded',
  FORGOT_TO_PUNCH: 'Forgot to punch at all',
};

/** What each kind asks the employee to supply, in one place both ends read. */
export const REGULARIZATION_KIND_HELP: Record<RegularizationKind, string> = {
  MISSING_IN: 'The out punch is recorded and the in punch is not. Give the time you arrived.',
  MISSING_OUT: 'The in punch is recorded and the out punch is not. Give the time you left.',
  WRONG_TIME: 'A punch was recorded at the wrong time. Give the time or times that are right.',
  FORGOT_TO_PUNCH: 'Neither punch was recorded. Give both times.',
};

/**
 * Which of the two times a kind requires, and which it forbids.
 *
 * A table rather than four branches, because the refinement below, the form's
 * field enabling and the server's own message all have to agree about it —
 * three copies of this rule is three places for them to stop agreeing.
 */
export const REGULARIZATION_KIND_TIMES: Record<
  RegularizationKind,
  { readonly in: 'required' | 'forbidden' | 'optional'; readonly out: 'required' | 'forbidden' | 'optional' }
> = {
  // The missing half is the one being supplied. Sending the other half would
  // silently move a punch the employee did not mention, which is the opposite
  // of REQ-D-12's "punches are immutable, corrections are separate records".
  MISSING_IN: { in: 'required', out: 'forbidden' },
  MISSING_OUT: { in: 'forbidden', out: 'required' },
  // Either end can be the wrong one, and both can be.
  WRONG_TIME: { in: 'optional', out: 'optional' },
  FORGOT_TO_PUNCH: { in: 'required', out: 'required' },
};

// ------------------------------------------------------------------ fields

/** `YYYY-MM-DD`. A calendar fact, never an instant (see `calendar-date.ts`). */
const calendarDateSchema = z.iso.date();

/**
 * `HH:mm`, 24-hour. Seconds are refused rather than truncated: a form that
 * cannot produce them means a client sending them is sending something this
 * contract has not agreed, and quietly dropping the tail is how two ends come
 * to disagree about what was stored.
 */
export const wallClockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'must be a 24-hour time, as HH:mm');

/**
 * REQ-F-01 makes the reason mandatory, and the floor is three characters —
 * the same floor a rejection reason has (REQ-F-05). "x" is not a reason, and
 * an approver reading a one-character justification has been given nothing to
 * decide on.
 */
const reasonField = z.string().trim().min(3).max(500);

// ----------------------------------------------------------- raise (F-01)

export const regularizationInputSchema = z
  .object({
    date: calendarDateSchema,
    kind: z.enum(REGULARIZATION_KINDS),
    requestedIn: wallClockSchema.nullable().default(null),
    requestedOut: wallClockSchema.nullable().default(null),
    reason: reasonField,
    /** REQ-F-01's optional attachment. No upload endpoint exists yet. */
    attachmentFileId: z.uuid().nullable().default(null),
    /**
     * Omitted means the caller raises it for themselves. Raising on somebody
     * else's behalf needs the approver key; the service checks it, because a
     * route guard cannot see which employee the body named.
     */
    employeeId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rules = REGULARIZATION_KIND_TIMES[value.kind];
    const supplied = { in: value.requestedIn !== null, out: value.requestedOut !== null };

    for (const end of ['in', 'out'] as const) {
      const path = end === 'in' ? 'requestedIn' : 'requestedOut';
      const label = end === 'in' ? 'arrival' : 'departure';
      if (rules[end] === 'required' && !supplied[end]) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: `${REGULARIZATION_KIND_LABELS[value.kind]} needs the ${label} time.`,
        });
      }
      if (rules[end] === 'forbidden' && supplied[end]) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: `${REGULARIZATION_KIND_LABELS[value.kind]} does not change the ${label} time.`,
        });
      }
    }

    // "Correct a punch" that corrects neither punch is a request with no
    // subject; the adjustment table refuses the row it would produce
    // (`attendance_adjustments_moves_something`), so it is refused here where
    // the message can name the field.
    if (value.kind === 'WRONG_TIME' && !supplied.in && !supplied.out) {
      ctx.addIssue({
        code: 'custom',
        path: ['requestedIn'],
        message: 'Give the arrival time, the departure time, or both.',
      });
    }
  });

export type RegularizationInput = z.infer<typeof regularizationInputSchema>;

/**
 * `PATCH /regularizations/:id/complete` -- what an employee supplies to turn
 * a `SYSTEM`-origin draft into a real request. The kind is already fixed to
 * `WRONG_TIME` and the times are already prefilled to the punch as it stands,
 * so both are optional here: the reason is the one thing only the employee
 * can give, and either time may be corrected in the same step rather than in
 * a second edit.
 */
export const regularizationCompleteSchema = z
  .object({
    reason: reasonField,
    requestedIn: wallClockSchema.nullable().optional(),
    requestedOut: wallClockSchema.nullable().optional(),
  })
  .strict();

export type RegularizationComplete = z.infer<typeof regularizationCompleteSchema>;

// --------------------------------------------------------- on duty (F-04)

export const onDutyInputSchema = z
  .object({
    fromDate: calendarDateSchema,
    toDate: calendarDateSchema,
    reason: reasonField,
    /** REQ-F-04's "optional client/site name". */
    siteName: z.string().trim().min(1).max(160).nullable().default(null),
    employeeId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toDate < value.fromDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['toDate'],
        message: 'must not be before the first day',
      });
    }
  });

export type OnDutyInput = z.infer<typeof onDutyInputSchema>;

/**
 * How long a single on-duty request may run.
 *
 * Approving one recomputes every day it covers, inline, in the approver's
 * request (see `RegularizationService.approveOnDuty`). Ninety days is a
 * quarter away at a client site, which is longer than anything the PRD
 * describes, and it bounds that loop at something a request can finish.
 */
export const ON_DUTY_MAX_DAYS = 90;

// ------------------------------------------------------------- decisions

/** REQ-F-05: a rejection always carries a reason the employee is told. */
export const regularizationDecisionSchema = z
  .object({ reason: z.string().trim().min(3).max(500).nullable().default(null) })
  .strict();

export type RegularizationDecision = z.infer<typeof regularizationDecisionSchema>;

export const regularizationRejectionSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export type RegularizationRejection = z.infer<typeof regularizationRejectionSchema>;

// ------------------------------------------------------------ read models

export interface RegularizationRequest {
  readonly id: string;
  readonly employee: NamedRef;
  readonly employeeCode: string;
  readonly date: string;
  readonly kind: RegularizationKind;
  /** ISO-8601 instants; the server composed them from the wall clock sent. */
  readonly requestedIn: string | null;
  readonly requestedOut: string | null;
  /** Null only for a `SYSTEM`-origin draft the employee has not completed yet. */
  readonly reason: string | null;
  readonly origin: RegularizationOrigin;
  readonly attachmentFileId: string | null;
  readonly status: ApprovalStatus;
  /**
   * REQ-I-01's generic approval, once that slice joins. Null today:
   * regularization decides on its own endpoints, so nothing has to be
   * unpicked when the framework starts creating rows.
   */
  readonly approvalRequestId: string | null;
  readonly raisedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: NamedRef | null;
  /** REQ-F-05: what the approver said, readable by the employee afterwards. */
  readonly decisionReason: string | null;
}

export interface OnDutyRequest {
  readonly id: string;
  readonly employee: NamedRef;
  readonly employeeCode: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reason: string;
  readonly siteName: string | null;
  readonly status: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly raisedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: NamedRef | null;
  readonly decisionReason: string | null;
}

/**
 * REQ-F-02's two limits, and how much of the monthly one this employee has
 * already spent.
 *
 * Sent to the form rather than hardcoded in it, because both numbers are org
 * settings an administrator can change (`attendance.regularization_window_days`
 * and `attendance.regularization_max_per_month`). A form that printed 7 and 3
 * from a constant would go on printing them after the setting moved, and the
 * first the employee would know is a refusal.
 */
export interface RegularizationPolicyView {
  readonly windowDays: number;
  readonly maxPerMonth: number;
  /** The oldest date that may still be regularized, in the employee's zone. */
  readonly earliestDate: string;
  /** Today where the employee is standing, which the client cannot know. */
  readonly today: string;
  readonly raisedThisMonth: number;
  readonly remainingThisMonth: number;
}

/** Why a raise was refused. The code is the contract; the message is prose. */
export const REGULARIZATION_REFUSALS = [
  'OUTSIDE_WINDOW',
  'FUTURE_DATE',
  'MONTHLY_CAP_REACHED',
  'PERIOD_LOCKED',
  'ALREADY_PENDING',
  'BEFORE_JOINING',
] as const;

export type RegularizationRefusal = (typeof REGULARIZATION_REFUSALS)[number];

// ---------------------------------------------------------------- queries

export const regularizationQuerySchema = pageQuerySchema
  .extend({
    status: z.enum(APPROVAL_STATUSES).optional(),
    employeeId: z.uuid().optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict();

export type RegularizationQuery = z.infer<typeof regularizationQuerySchema>;

export const onDutyQuerySchema = regularizationQuerySchema;

export type OnDutyQuery = z.infer<typeof onDutyQuerySchema>;
