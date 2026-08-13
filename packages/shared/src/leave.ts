import { z } from 'zod';

import {
  APPROVAL_STATUSES,
  EMPLOYMENT_TYPES,
  LEAVE_ACCRUAL_METHODS,
  LEAVE_DAY_PORTIONS,
  LEAVE_MOVEMENT_TYPES,
  type ApprovalStatus,
  type EmploymentType,
  type LeaveAccrualMethod,
  type LeaveDayPortion,
  type LeaveMovementType,
} from './enums.js';
import { pageQuerySchema } from './pagination.js';
import type { NamedRef } from './people.js';

/**
 * Leave types, balances, the ledger and applications (REQ-G-01 to REQ-G-12).
 *
 * Here rather than in the API for the reason the punch contract gives: the
 * server parses requests with these schemas and the web client builds its
 * screens against the same types, so the two cannot drift into a field one end
 * sends and the other silently discards.
 *
 * Nothing in this file touches money. `isEncashable` is a flag HR reads;
 * REQ-G-01 calls it "informational only" and CLAUDE.md §3 rule 7 forbids the
 * calculation that would otherwise follow it.
 */

// -------------------------------------------------------------- primitives

/**
 * Leave is counted in days and half days, matching `numeric(6,2)` in the
 * database. Two decimals is the contract, not a formatting preference: a
 * pro-rated accrual of 10/12 of a day has to land on a value both ends agree
 * about, and a third of a day does not exist in the column it is stored in.
 */
export const LEAVE_DAYS_SCALE = 2;

/** The largest `numeric(6,2)` can hold, so a schema refuses what the column would. */
export const MAX_LEAVE_DAYS = 9999.99;

/**
 * Rounds to the stored scale.
 *
 * Every ledger amount passes through this before it is written, and every
 * balance bucket after it is summed. Without it the invariant below fails on
 * arithmetic alone: 0.1 + 0.2 is not 0.3 in a binary float, and a balance that
 * disagrees with its own ledger by 4e-17 is indistinguishable, to the check
 * constraint in migration 0009, from one that is genuinely wrong.
 */
export function roundLeaveDays(value: number): number {
  // `+ 0` normalises negative zero. A reversal that cancels an availed exactly
  // leaves -0, which compares equal to 0 but serialises, sorts and formats as
  // a different value -- "-0 days availed" is the kind of thing a reader
  // reports as a bug in the balance rather than in the rounding.
  return Math.round(value * 100) / 100 + 0;
}

const daysSchema = z
  .number()
  .finite()
  .min(-MAX_LEAVE_DAYS)
  .max(MAX_LEAVE_DAYS)
  .transform(roundLeaveDays);

/** A non-negative quantity of days: an entitlement, a cap, a limit. */
const nonNegativeDaysSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_LEAVE_DAYS)
  .transform(roundLeaveDays);

/** NFR-05: a calendar date, not an instant. */
const calendarDateSchema = z.iso.date();

// ------------------------------------------------------------- leave types

export interface LeaveTypeRef extends NamedRef {
  readonly code: string;
}

/**
 * REQ-G-01, every rule as a field.
 *
 * The five seed types of REQ-G-02 are "all editable" and the real entitlements
 * are still unanswered (OPEN-QUESTIONS item 4), so no value here carries a
 * business default -- the placeholders live in the seed, labelled as such.
 */
export interface LeaveTypePolicy {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly isPaid: boolean;
  readonly accrualMethod: LeaveAccrualMethod;
  readonly annualEntitlement: number;
  readonly carryForwardAllowed: boolean;
  /** Null with `carryForwardAllowed` means carry the whole balance forward. */
  readonly carryForwardCap: number | null;
  /** REQ-G-08. 0 means a negative balance is not allowed at all. */
  readonly negativeBalanceLimit: number;
  /** Informational only; no amount is ever computed from it (NFR-10). */
  readonly isEncashable: boolean;
  readonly allowsHalfDay: boolean;
  readonly minDays: number | null;
  readonly maxDays: number | null;
  readonly noticeDays: number;
  readonly attachmentRequiredAfterDays: number | null;
  /** REQ-G-07: when true, non-working days sandwiched in the range are consumed. */
  readonly countsSandwichDays: boolean;
  /** REQ-G-09: manager, then HR. */
  readonly requiresTwoStepApproval: boolean;
  /** Empty means every employment type. */
  readonly applicableEmploymentTypes: readonly EmploymentType[];
  readonly isActive: boolean;
}

/**
 * The shape of a leave type as it is written.
 *
 * `.strict()` throughout this file: a field the client renamed must fail
 * loudly rather than be dropped, which on a policy object would silently
 * reset the rule it names.
 */
export const leaveTypeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Upper-cased on the way in so `CL` and `cl` cannot both exist. */
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/u, 'may contain letters, digits, underscore and hyphen')
      .transform((value) => value.toUpperCase()),
    isPaid: z.boolean().default(true),
    accrualMethod: z.enum(LEAVE_ACCRUAL_METHODS).default('NONE'),
    annualEntitlement: nonNegativeDaysSchema.default(0),
    carryForwardAllowed: z.boolean().default(false),
    carryForwardCap: nonNegativeDaysSchema.nullable().default(null),
    negativeBalanceLimit: nonNegativeDaysSchema.default(0),
    isEncashable: z.boolean().default(false),
    allowsHalfDay: z.boolean().default(true),
    minDays: nonNegativeDaysSchema.nullable().default(null),
    maxDays: nonNegativeDaysSchema.nullable().default(null),
    noticeDays: z.number().int().min(0).max(365).default(0),
    attachmentRequiredAfterDays: nonNegativeDaysSchema.nullable().default(null),
    countsSandwichDays: z.boolean().default(false),
    requiresTwoStepApproval: z.boolean().default(false),
    applicableEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minDays !== null && value.maxDays !== null && value.minDays > value.maxDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDays'],
        message: 'must not be smaller than the minimum days per application',
      });
    }
    if (!value.carryForwardAllowed && value.carryForwardCap !== null) {
      // A cap on a type that cannot carry forward is a rule nobody reads, and
      // ticking the box later would silently activate a number set months ago.
      ctx.addIssue({
        code: 'custom',
        path: ['carryForwardCap'],
        message: 'is only meaningful when carry forward is allowed',
      });
    }
  });

export type LeaveTypeInput = z.infer<typeof leaveTypeInputSchema>;

/**
 * PATCH sends only what changed.
 *
 * Built from the inner object rather than from `leaveTypeInputSchema` because
 * `.partial()` cannot be applied after `.superRefine`, and the cross-field
 * rules cannot run on a partial anyway -- the service re-validates the merged
 * row against the full schema, which is where those rules belong.
 */
export const leaveTypePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    isPaid: z.boolean(),
    accrualMethod: z.enum(LEAVE_ACCRUAL_METHODS),
    annualEntitlement: nonNegativeDaysSchema,
    carryForwardAllowed: z.boolean(),
    carryForwardCap: nonNegativeDaysSchema.nullable(),
    negativeBalanceLimit: nonNegativeDaysSchema,
    isEncashable: z.boolean(),
    allowsHalfDay: z.boolean(),
    minDays: nonNegativeDaysSchema.nullable(),
    maxDays: nonNegativeDaysSchema.nullable(),
    noticeDays: z.number().int().min(0).max(365),
    attachmentRequiredAfterDays: nonNegativeDaysSchema.nullable(),
    countsSandwichDays: z.boolean(),
    requiresTwoStepApproval: z.boolean(),
    applicableEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

export type LeaveTypePatch = z.infer<typeof leaveTypePatchSchema>;

/** The code is immutable once issued: the ledger and every report cite it. */
export const leaveTypeQuerySchema = pageQuerySchema
  .extend({
    /** Omitted returns every type; the policy screen needs the retired ones. */
    active: z
      .union([z.literal('true'), z.literal('false')])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export type LeaveTypeQuery = z.infer<typeof leaveTypeQuerySchema>;

// ---------------------------------------------------------------- balances

/**
 * REQ-G-03. Six numbers, and the seventh fact is that they add up.
 *
 * `availed` is stored positive -- it is a quantity taken, not a signed
 * movement -- which is why the invariant subtracts it. The ledger underneath
 * stores AVAILED as a negative row, so the two directions meet in
 * `projectLedger` on the server and in the check constraint in the database.
 */
export interface LeaveBalance {
  readonly leaveType: LeaveTypeRef;
  readonly leaveYear: number;
  readonly opening: number;
  readonly accrued: number;
  readonly availed: number;
  readonly adjusted: number;
  readonly carriedForward: number;
  readonly closing: number;
}

/**
 * THE INVARIANT (REQ-G-03).
 *
 * Written once, here, and used by the server's projection, by its property
 * test, and by the database check constraint added in migration 0009 -- three
 * enforcement points that all quote the same line rather than three
 * re-derivations that can disagree.
 */
export function closingLeaveBalance(input: {
  readonly opening: number;
  readonly accrued: number;
  readonly availed: number;
  readonly adjusted: number;
  readonly carriedForward: number;
}): number {
  return roundLeaveDays(
    input.opening + input.accrued - input.availed + input.adjusted + input.carriedForward,
  );
}

export function isLeaveBalanceConsistent(balance: {
  readonly opening: number;
  readonly accrued: number;
  readonly availed: number;
  readonly adjusted: number;
  readonly carriedForward: number;
  readonly closing: number;
}): boolean {
  return closingLeaveBalance(balance) === roundLeaveDays(balance.closing);
}

export const leaveBalanceQuerySchema = z
  .object({
    /** The calendar year the leave year opens in (REQ-G-04). */
    year: z.coerce.number().int().min(1970).max(2999),
    /** Omitted means the caller's own balances. */
    employeeId: z.uuid().optional(),
  })
  .strict();

export type LeaveBalanceQuery = z.infer<typeof leaveBalanceQuerySchema>;

// ------------------------------------------------------------------ ledger

/** REQ-G-03: "every movement is a ledger row referencing its cause". */
export interface LeaveLedgerEntry {
  readonly id: string;
  readonly leaveType: LeaveTypeRef;
  readonly leaveYear: number;
  readonly movementType: LeaveMovementType;
  /** Signed. AVAILED and LAPSE are negative; ACCRUAL and REVERSAL positive. */
  readonly days: number;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

/**
 * REQ-G-03's `adjusted` bucket, as an action.
 *
 * Signed, and a reason is mandatory: an adjustment is the one movement with no
 * cause of its own -- an accrual points at a period and an availed at a
 * request, while this points only at whoever typed it.
 */
export const leaveAdjustmentSchema = z
  .object({
    employeeId: z.uuid(),
    leaveTypeId: z.uuid(),
    year: z.number().int().min(1970).max(2999),
    days: daysSchema.refine((value) => value !== 0, 'must not be zero'),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type LeaveAdjustment = z.infer<typeof leaveAdjustmentSchema>;

export const leaveLedgerQuerySchema = pageQuerySchema
  .extend({
    year: z.coerce.number().int().min(1970).max(2999),
    employeeId: z.uuid().optional(),
    leaveTypeId: z.uuid().optional(),
    movementType: z.enum(LEAVE_MOVEMENT_TYPES).optional(),
  })
  .strict();

export type LeaveLedgerQuery = z.infer<typeof leaveLedgerQuerySchema>;

/**
 * Which balance bucket a movement lands in.
 *
 * REVERSAL is deliberately mapped to `availed` and nowhere else: it is written
 * by exactly one thing, the cancellation in REQ-G-10, and giving it a second
 * meaning would make a cancelled leave indistinguishable from a correction.
 * Anything else is an ADJUSTMENT.
 */
export const LEAVE_MOVEMENT_BUCKET = {
  OPENING: 'opening',
  ACCRUAL: 'accrued',
  AVAILED: 'availed',
  ADJUSTMENT: 'adjusted',
  CARRY_FORWARD: 'carriedForward',
  ENCASHMENT: 'adjusted',
  LAPSE: 'adjusted',
  REVERSAL: 'availed',
} as const satisfies Record<
  LeaveMovementType,
  'opening' | 'accrued' | 'availed' | 'adjusted' | 'carriedForward'
>;

export type LeaveBalanceBucket = (typeof LEAVE_MOVEMENT_BUCKET)[LeaveMovementType];

// ------------------------------------------------------------ applications

export interface LeaveRequestDay {
  readonly date: string;
  readonly portion: LeaveDayPortion;
  /** False for a weekly off or holiday inside the range that is not deducted. */
  readonly isCounted: boolean;
}

export interface LeaveRequest {
  readonly id: string;
  readonly employee: NamedRef;
  readonly leaveType: LeaveTypeRef;
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalDays: number;
  readonly reason: string | null;
  readonly status: ApprovalStatus;
  readonly attachmentFileId: string | null;
  /**
   * REQ-I-01's generic approval, once that slice lands. Null today: leave
   * writes no approval row of its own, so nothing here has to be unpicked
   * when the framework starts creating them.
   */
  readonly approvalRequestId: string | null;
  readonly appliedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: NamedRef | null;
  readonly cancelledAt: string | null;
}

export interface LeaveRequestDetail extends LeaveRequest {
  readonly days: readonly LeaveRequestDay[];
}

/**
 * REQ-G-06.
 *
 * A half day is sent as the portion of its boundary day rather than as a
 * boolean: "half day" alone does not say which half, and the day engine needs
 * the half to resolve a punch against it (REQ-E-02).
 */
export const leaveApplicationSchema = z
  .object({
    leaveTypeId: z.uuid(),
    fromDate: calendarDateSchema,
    toDate: calendarDateSchema,
    fromPortion: z.enum(LEAVE_DAY_PORTIONS).default('FULL'),
    toPortion: z.enum(LEAVE_DAY_PORTIONS).default('FULL'),
    reason: z.string().trim().min(1).max(500).nullable().default(null),
    attachmentFileId: z.uuid().nullable().default(null),
    /**
     * Omitted means the caller applies for themselves. HR applying on
     * somebody's behalf needs `leave.approve.all`; the service checks it.
     */
    employeeId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toDate < value.fromDate) {
      ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'must not be before the start date' });
    }
  });

export type LeaveApplication = z.infer<typeof leaveApplicationSchema>;

/**
 * REQ-G-06's live preview: "the form shows the computed working days consumed
 * and the balance before/after, before submission".
 *
 * A GET rather than a dry-run POST, so it is cacheable, cannot be mistaken for
 * a submission by a retry, and needs no idempotency key. It reads the same
 * calendar the application will and returns the same day expansion, so the
 * number on the form is the number that will be deducted.
 */
export const leavePreviewQuerySchema = z
  .object({
    leaveTypeId: z.uuid(),
    fromDate: calendarDateSchema,
    toDate: calendarDateSchema,
    fromPortion: z.enum(LEAVE_DAY_PORTIONS).default('FULL'),
    toPortion: z.enum(LEAVE_DAY_PORTIONS).default('FULL'),
    employeeId: z.uuid().optional(),
  })
  .strict();

export type LeavePreviewQuery = z.infer<typeof leavePreviewQuerySchema>;

/** Why a preview says the application cannot be submitted as it stands. */
export const LEAVE_PREVIEW_BLOCKERS = [
  'INSUFFICIENT_BALANCE',
  'NEGATIVE_LIMIT_EXCEEDED',
  'OVERLAPS_EXISTING',
  'NOTICE_PERIOD',
  'ATTACHMENT_REQUIRED',
  'BELOW_MINIMUM_DAYS',
  'ABOVE_MAXIMUM_DAYS',
  'NO_WORKING_DAYS',
  'PERIOD_LOCKED',
  'HALF_DAY_NOT_ALLOWED',
  'EMPLOYMENT_TYPE_NOT_ALLOWED',
  'TYPE_INACTIVE',
] as const;

export type LeavePreviewBlocker = (typeof LEAVE_PREVIEW_BLOCKERS)[number];

export interface LeavePreview {
  readonly leaveType: LeaveTypeRef;
  readonly fromDate: string;
  readonly toDate: string;
  /** Every date in the range, counted or not, so the form can show the reason. */
  readonly days: readonly LeaveRequestDay[];
  readonly calendarDays: number;
  readonly workingDays: number;
  readonly holidaysSkipped: number;
  readonly weeklyOffsSkipped: number;
  /** REQ-G-07: non-working days consumed because the type counts sandwiches. */
  readonly sandwichDaysCounted: number;
  readonly halfDays: number;
  /** The number that will be deducted. */
  readonly totalDays: number;
  readonly leaveYear: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly negativeBalanceLimit: number;
  readonly blockers: readonly LeavePreviewBlocker[];
}

export const leaveRequestQuerySchema = pageQuerySchema
  .extend({
    status: z.enum(APPROVAL_STATUSES).optional(),
    employeeId: z.uuid().optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    /** Only what this caller may act on -- the approver's queue (REQ-G-09). */
    pendingForMe: z
      .union([z.literal('true'), z.literal('false')])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export type LeaveRequestQuery = z.infer<typeof leaveRequestQuerySchema>;

/** REQ-F-05: a rejection always carries a reason the employee is told. */
export const leaveDecisionSchema = z
  .object({
    reason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict();

export type LeaveDecision = z.infer<typeof leaveDecisionSchema>;

export const leaveRejectionSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type LeaveRejection = z.infer<typeof leaveRejectionSchema>;

export const leaveCancellationSchema = z
  .object({
    reason: z.string().trim().min(3).max(500).nullable().default(null),
  })
  .strict();

export type LeaveCancellation = z.infer<typeof leaveCancellationSchema>;

// ---------------------------------------------------------------- comp-off

/**
 * REQ-G-11. A credit earned for working a holiday or a weekly off, expiring
 * 30 days later by default.
 */
export interface CompOffCredit {
  readonly id: string;
  readonly employee: NamedRef;
  readonly leaveType: LeaveTypeRef;
  readonly earnedForDate: string;
  readonly days: number;
  readonly expiresOn: string;
  readonly consumedByLeaveRequestId: string | null;
  readonly lapsedAt: string | null;
  readonly createdAt: string;
}

export const compOffGrantSchema = z
  .object({
    employeeId: z.uuid(),
    earnedForDate: calendarDateSchema,
    /** A worked holiday is a day or a half day; nothing else is grantable. */
    days: z.union([z.literal(0.5), z.literal(1)]).default(1),
    /** Overrides the org's expiry window for this one credit. */
    expiresOn: calendarDateSchema.optional(),
    note: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();

export type CompOffGrant = z.infer<typeof compOffGrantSchema>;

export const compOffQuerySchema = pageQuerySchema
  .extend({
    employeeId: z.uuid().optional(),
    /** REQ-G-11: "expired credits appear on a report rather than vanishing". */
    state: z.enum(['ACTIVE', 'LAPSED', 'CONSUMED']).optional(),
  })
  .strict();

export type CompOffQuery = z.infer<typeof compOffQuerySchema>;

// --------------------------------------------------------------- calendar

/** REQ-G-12: who is away this month, and where the department is thin. */
export const leaveCalendarQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    departmentId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must not be before the start date' });
    }
  });

export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;

export interface LeaveCalendarEntry {
  readonly employee: NamedRef;
  readonly department: NamedRef | null;
  readonly leaveType: LeaveTypeRef;
  readonly date: string;
  readonly portion: LeaveDayPortion;
  readonly leaveRequestId: string;
}

/** A date on which more of a department is away than the threshold allows. */
export interface LeaveCalendarWarning {
  readonly date: string;
  readonly department: NamedRef | null;
  readonly awayCount: number;
  readonly threshold: number;
}

export interface LeaveCalendar {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly LeaveCalendarEntry[];
  readonly warnings: readonly LeaveCalendarWarning[];
  readonly threshold: number;
}

// --------------------------------------------------------------- leave year

/**
 * REQ-G-04: "leave year start month is configurable (default April)".
 *
 * The year a date belongs to is the calendar year the leave year *opened* in,
 * so 2027-02-10 with an April start is leave year 2026. Both ends need this --
 * the form labels the balance band with it and the server keys the ledger on
 * it -- so it is defined once here.
 */
export const DEFAULT_LEAVE_YEAR_START_MONTH = 4;

export function leaveYearOf(date: string, startMonth: number): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${date}".`);
  }
  return month >= startMonth ? year : year - 1;
}

/** The first and last calendar date of a leave year, inclusive. */
export function leaveYearBounds(
  leaveYear: number,
  startMonth: number,
): { readonly start: string; readonly end: string } {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const start = `${String(leaveYear)}-${pad(startMonth)}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? leaveYear : leaveYear + 1;
  // Day 0 of the following month is the last day of this one, so February and
  // the leap day come from the runtime rather than from a table written here.
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { start, end: `${String(endYear)}-${pad(endMonth)}-${pad(lastDay)}` };
}

// ------------------------------------------------------------------ labels

export const LEAVE_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  ESCALATED: 'Escalated',
};

export const LEAVE_ACCRUAL_METHOD_LABELS: Record<LeaveAccrualMethod, string> = {
  NONE: 'None',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
  ON_JOINING: 'On joining',
};

export const LEAVE_MOVEMENT_LABELS: Record<LeaveMovementType, string> = {
  OPENING: 'Opening',
  ACCRUAL: 'Accrued',
  AVAILED: 'Availed',
  ADJUSTMENT: 'Adjustment',
  CARRY_FORWARD: 'Carried forward',
  ENCASHMENT: 'Encashed',
  LAPSE: 'Lapsed',
  REVERSAL: 'Reversed',
};

export const LEAVE_PREVIEW_BLOCKER_LABELS: Record<LeavePreviewBlocker, string> = {
  INSUFFICIENT_BALANCE: 'There is not enough balance for these dates.',
  NEGATIVE_LIMIT_EXCEEDED: 'This would take the balance past the negative limit for this type.',
  OVERLAPS_EXISTING: 'These dates overlap leave that has already been applied for.',
  NOTICE_PERIOD: 'This type needs more notice than these dates give.',
  ATTACHMENT_REQUIRED: 'A supporting document is required for a leave this long.',
  BELOW_MINIMUM_DAYS: 'This is shorter than the minimum this type allows.',
  ABOVE_MAXIMUM_DAYS: 'This is longer than the maximum this type allows.',
  NO_WORKING_DAYS: 'Every day in this range is a holiday or a weekly off.',
  PERIOD_LOCKED: 'These dates fall in a locked period.',
  HALF_DAY_NOT_ALLOWED: 'This type cannot be taken as a half day.',
  EMPLOYMENT_TYPE_NOT_ALLOWED: 'This type is not available for this employment type.',
  TYPE_INACTIVE: 'This leave type is no longer in use.',
};
