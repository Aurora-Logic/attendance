import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { organizations, users } from '../../../platform/db/schema/index.js';

export const approvalTypeEnum = pgEnum('approval_type', [
  'LEAVE',
  'REGULARIZATION',
  'ON_DUTY',
  'FLAGGED_PUNCH',
  'DEVICE_REBIND',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'ESCALATED',
]);

/** Null on a step nobody has acted on yet, which is how "awaiting" is stored. */
export const approvalActionEnum = pgEnum('approval_action', [
  'APPROVE',
  'REJECT',
  'DELEGATE',
  'ESCALATE',
]);

/**
 * REQ-I-01. One framework for every approvable thing, which is why the subject
 * is a polymorphic (type, id) pair rather than five nullable foreign keys: CRM
 * and ERP will raise approvals too (technical design §14.4), and a column per
 * subject type would mean a migration for each.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    type: approvalTypeEnum('type').notNull(),
    requesterUserId: uuid('requester_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    currentStep: integer('current_step').notNull().default(1),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    /** REQ-I-04: set by the escalation job, so it is a fact, not a flag. */
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (t) => [
    // Technical design §4.3, verbatim: the approvals inbox query.
    index('approval_requests_queue_idx').on(t.orgId, t.status, t.currentStep),
    index('approval_requests_subject_idx').on(t.orgId, t.subjectType, t.subjectId),
    index('approval_requests_requester_idx').on(t.orgId, t.requesterUserId),
  ],
);

/** REQ-I-02/I-03: the per-step record, including who a step was delegated from. */
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    approvalRequestId: uuid('approval_request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    stepNo: integer('step_no').notNull(),
    approverUserId: uuid('approver_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    delegatedFromUserId: uuid('delegated_from_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: approvalActionEnum('action'),
    /** REQ-F-05: a rejection is not valid without one. */
    reason: text('reason'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('approval_steps_request_step_uq')
      .on(t.approvalRequestId, t.stepNo)
      .where(ALIVE),
    index('approval_steps_approver_idx').on(t.orgId, t.approverUserId),
  ],
);
