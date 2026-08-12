import { z } from 'zod';

import {
  APPROVAL_STATUSES,
  LEAVE_ACCRUAL_METHODS,
  LEAVE_DAY_PORTIONS,
  type ApprovalStatus,
  type LeaveAccrualMethod,
  type LeaveDayPortion,
  type Paginated,
} from '@vyuha/shared';

/**
 * The leave contracts, as this screen reads them.
 *
 * These live beside the screens rather than in `@vyuha/shared` because the
 * server side of Phase 2 has not been written yet: putting a guess into the
 * contract package would make it look agreed. When the endpoints land, these
 * move up into the package and the schemas below become the parser on both
 * sides.
 *
 * Everything is parsed at the boundary for the same reason the employee list
 * is (see use-employees.ts): an unvalidated response fails three components
 * deep in a cell renderer, and the stack trace names the table rather than the
 * field the server changed.
 */

export interface NamedRef {
  id: string;
  name: string;
}

export interface LeaveTypeRef extends NamedRef {
  code: string;
}

/** REQ-G-03. Days, not hours; fractional when half days are involved. */
export interface LeaveBalance {
  leaveType: LeaveTypeRef;
  leaveYear: number;
  opening: number;
  accrued: number;
  availed: number;
  adjusted: number;
  carriedForward: number;
  closing: number;
}

export interface LeaveRequest {
  id: string;
  leaveType: NamedRef;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: ApprovalStatus;
  appliedAt: string;
  approver: NamedRef | null;
}

/** REQ-G-01. No money-adjacent field appears here by design (NFR-10). */
export interface LeaveTypePolicy {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  accrualMethod: LeaveAccrualMethod;
  annualEntitlement: number;
  /** 0 means carry-forward is not allowed for this type. */
  carryForwardCap: number;
  /** REQ-G-08. 0 means a negative balance is not allowed. */
  negativeBalanceLimit: number;
  noticeDays: number;
  halfDayAllowed: boolean;
  /** Informational only. There is no encashment amount in this product (NFR-10). */
  encashable: boolean;
  /** REQ-G-07: when true, holidays and weekly offs inside the range are consumed. */
  countsSandwichDays: boolean;
}

const namedRefSchema: z.ZodType<NamedRef> = z.object({
  id: z.string(),
  name: z.string(),
});

const leaveTypeRefSchema: z.ZodType<LeaveTypeRef> = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
});

export const leaveBalanceSchema: z.ZodType<LeaveBalance> = z.object({
  leaveType: leaveTypeRefSchema,
  leaveYear: z.number().int(),
  opening: z.number(),
  accrued: z.number(),
  availed: z.number(),
  adjusted: z.number(),
  carriedForward: z.number(),
  closing: z.number(),
});

export const leaveRequestSchema: z.ZodType<LeaveRequest> = z.object({
  id: z.string(),
  leaveType: namedRefSchema,
  fromDate: z.string(),
  toDate: z.string(),
  totalDays: z.number(),
  reason: z.string(),
  status: z.enum(APPROVAL_STATUSES),
  appliedAt: z.string(),
  approver: namedRefSchema.nullable(),
});

export const leaveTypePolicySchema: z.ZodType<LeaveTypePolicy> = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  paid: z.boolean(),
  accrualMethod: z.enum(LEAVE_ACCRUAL_METHODS),
  annualEntitlement: z.number(),
  carryForwardCap: z.number(),
  negativeBalanceLimit: z.number(),
  noticeDays: z.number().int(),
  halfDayAllowed: z.boolean(),
  encashable: z.boolean(),
  countsSandwichDays: z.boolean(),
});

const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/** Technical design §6: every collection endpoint answers in this envelope. */
export function paginatedSchema<T>(item: z.ZodType<T>): z.ZodType<Paginated<T>> {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}

/**
 * REQ-G-06 request body.
 *
 * A day the employee takes as a half day is sent as its portion rather than as
 * a boolean, because "half day" alone does not say which half, and the day
 * engine needs the half to resolve a punch against it (REQ-E-02).
 */
export const leaveApplicationSchema = z.object({
  leaveTypeId: z.string().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromPortion: z.enum(LEAVE_DAY_PORTIONS),
  toPortion: z.enum(LEAVE_DAY_PORTIONS),
  reason: z.string().min(1).max(500),
  attachmentFileId: z.string().nullable(),
});

export type LeaveApplication = z.infer<typeof leaveApplicationSchema>;

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

export type { ApprovalStatus, LeaveAccrualMethod, LeaveDayPortion };
