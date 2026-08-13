import { z } from 'zod';

import {
  APPROVAL_STATUSES,
  LEAVE_ACCRUAL_METHODS,
  LEAVE_DAY_PORTIONS,
  LEAVE_PREVIEW_BLOCKERS,
  type ApprovalStatus,
  type CompOffCredit,
  type LeaveAccrualMethod,
  type LeaveBalance,
  type LeaveDayPortion,
  type LeavePreview,
  type LeavePreviewBlocker,
  type LeaveRequest,
  type LeaveRequestDay,
  type LeaveRequestDetail,
  type LeaveTypePolicy,
  type LeaveTypeRef,
  type NamedRef,
  type Paginated,
} from '@vyuha/shared';

/**
 * The parsers for the leave endpoints, against the contract in
 * `@vyuha/shared`.
 *
 * The *types* now come from the package -- the server side of REQ-G exists, so
 * a second definition here would be a second thing to keep in step. What stays
 * is the parsing and the presentation vocabulary: every response is validated
 * at the boundary for the reason the employee list gives (see
 * use-employees.ts), because an unvalidated response fails three components
 * deep in a cell renderer and the stack trace names the table rather than the
 * field the server changed.
 *
 * Each schema below is declared `satisfies z.ZodType<T>` against the shared
 * interface, so a field the server adds and this file forgets is a compile
 * error rather than a value that silently never reaches the screen.
 */

const namedRefSchema = z.object({
  id: z.string(),
  name: z.string(),
}) satisfies z.ZodType<NamedRef>;

const leaveTypeRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
}) satisfies z.ZodType<LeaveTypeRef>;

/** REQ-G-03. Days, not hours; fractional when half days are involved. */
export const leaveBalanceSchema = z.object({
  leaveType: leaveTypeRefSchema,
  leaveYear: z.number().int(),
  opening: z.number(),
  accrued: z.number(),
  availed: z.number(),
  adjusted: z.number(),
  carriedForward: z.number(),
  closing: z.number(),
}) satisfies z.ZodType<LeaveBalance>;

const leaveRequestDaySchema = z.object({
  date: z.string(),
  portion: z.enum(LEAVE_DAY_PORTIONS),
  isCounted: z.boolean(),
}) satisfies z.ZodType<LeaveRequestDay>;

export const leaveRequestSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  leaveType: leaveTypeRefSchema,
  fromDate: z.string(),
  toDate: z.string(),
  totalDays: z.number(),
  reason: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  attachmentFileId: z.string().nullable(),
  approvalRequestId: z.string().nullable(),
  appliedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: namedRefSchema.nullable(),
  cancelledAt: z.string().nullable(),
}) satisfies z.ZodType<LeaveRequest>;

export const leaveRequestDetailSchema = leaveRequestSchema.extend({
  days: z.array(leaveRequestDaySchema),
}) satisfies z.ZodType<LeaveRequestDetail>;

/** REQ-G-01. No money-adjacent field appears here by design (NFR-10). */
export const leaveTypePolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isPaid: z.boolean(),
  accrualMethod: z.enum(LEAVE_ACCRUAL_METHODS),
  annualEntitlement: z.number(),
  carryForwardAllowed: z.boolean(),
  carryForwardCap: z.number().nullable(),
  negativeBalanceLimit: z.number(),
  isEncashable: z.boolean(),
  allowsHalfDay: z.boolean(),
  minDays: z.number().nullable(),
  maxDays: z.number().nullable(),
  noticeDays: z.number().int(),
  attachmentRequiredAfterDays: z.number().nullable(),
  countsSandwichDays: z.boolean(),
  requiresTwoStepApproval: z.boolean(),
  applicableEmploymentTypes: z.array(z.enum(['PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN'])),
  isActive: z.boolean(),
}) satisfies z.ZodType<LeaveTypePolicy>;

/** REQ-G-06: the server's own count of what the application will consume. */
export const leavePreviewSchema = z.object({
  leaveType: leaveTypeRefSchema,
  fromDate: z.string(),
  toDate: z.string(),
  days: z.array(leaveRequestDaySchema),
  calendarDays: z.number().int(),
  workingDays: z.number().int(),
  holidaysSkipped: z.number().int(),
  weeklyOffsSkipped: z.number().int(),
  sandwichDaysCounted: z.number().int(),
  halfDays: z.number().int(),
  totalDays: z.number(),
  leaveYear: z.number().int(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  negativeBalanceLimit: z.number(),
  blockers: z.array(z.enum(LEAVE_PREVIEW_BLOCKERS)),
}) satisfies z.ZodType<LeavePreview>;

export const compOffCreditSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  leaveType: leaveTypeRefSchema,
  earnedForDate: z.string(),
  days: z.number(),
  expiresOn: z.string(),
  consumedByLeaveRequestId: z.string().nullable(),
  lapsedAt: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<CompOffCredit>;

const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/** Technical design §6: every collection endpoint answers in this envelope. */
export function paginatedSchema<T>(item: z.ZodType<T>): z.ZodType<Paginated<T>> {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}

export const LEAVE_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  ESCALATED: 'Escalated',
};

/**
 * Approved is the ordinary resting state and reads as unremarkable. Pending
 * and escalated are the two a person scans for, so they take the filled
 * variant; rejected takes the destructive one because it is the outcome that
 * needs an explanation.
 */
export const LEAVE_STATUS_VARIANT: Record<
  ApprovalStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'default',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  ESCALATED: 'default',
};

export const ACCRUAL_METHOD_LABELS: Record<LeaveAccrualMethod, string> = {
  NONE: 'None',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
  ON_JOINING: 'On joining',
};

export type {
  ApprovalStatus,
  CompOffCredit,
  LeaveAccrualMethod,
  LeaveBalance,
  LeaveDayPortion,
  LeavePreview,
  LeavePreviewBlocker,
  LeaveRequest,
  LeaveRequestDay,
  LeaveRequestDetail,
  LeaveTypePolicy,
  LeaveTypeRef,
  NamedRef,
};
