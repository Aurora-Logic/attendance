import { z } from 'zod';

import {
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  type ApprovalStatus,
  type ApprovalType,
} from '@vyuha/shared';

import type { NamedRef } from '@/features/leave/types';

/**
 * REQ-I-01: one approval mechanism for leave, regularization, on-duty,
 * flagged punches and device rebinding. There is deliberately no per-type
 * shape here — the inbox renders a request by what every type has in common,
 * and `subject` is the server's one-line statement of what is being asked.
 * A screen that branched on `type` to build its own sentence per type would
 * be the four separate inboxes REQ-I-01 forbids.
 */
export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  requester: NamedRef;
  subject: string;
  submittedAt: string;
  /** REQ-I-02: which step of the route it is sitting on, 1-based. */
  currentStep: number;
  status: ApprovalStatus;
}

const namedRefSchema: z.ZodType<NamedRef> = z.object({
  id: z.string(),
  name: z.string(),
});

export const approvalRequestSchema: z.ZodType<ApprovalRequest> = z.object({
  id: z.string(),
  type: z.enum(APPROVAL_TYPES),
  requester: namedRefSchema,
  subject: z.string(),
  submittedAt: z.string(),
  currentStep: z.number().int(),
  status: z.enum(APPROVAL_STATUSES),
});

/** REQ-F-05: a rejection always carries a reason, and the requester is told it. */
export const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const approveSchema = z.object({
  reason: z.string().max(500).optional(),
});

/** REQ-I-03: bulk actions apply to one request type at a time. */
export const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(500).optional(),
});

export type BulkAction = z.infer<typeof bulkActionSchema>;

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  LEAVE: 'Leave',
  REGULARIZATION: 'Regularization',
  ON_DUTY: 'On duty',
  FLAGGED_PUNCH: 'Flagged punch',
  DEVICE_REBIND: 'Device rebind',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  ESCALATED: 'Escalated',
};

export const APPROVAL_STATUS_VARIANT: Record<
  ApprovalStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'default',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  ESCALATED: 'default',
};

export type { ApprovalStatus, ApprovalType };
