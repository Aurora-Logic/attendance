import { z } from 'zod';

import {
  APPROVAL_STATUSES,
  REGULARIZATION_KINDS,
  REGULARIZATION_ORIGINS,
  type NamedRef,
  type OnDutyRequest,
  type Paginated,
  type RegularizationPolicyView,
  type RegularizationRequest,
} from '@vyuha/shared';

/**
 * The parsers for the regularization and on-duty endpoints, against the
 * contract in `@vyuha/shared`.
 *
 * The types come from the package; only the parsing and the presentation
 * vocabulary live here. Every response is validated at the boundary for the
 * reason the leave module gives — an unvalidated response fails three
 * components deep in a cell renderer, and the stack names the table rather
 * than the field the server changed.
 *
 * Each schema is `satisfies z.ZodType<T>` against the shared interface, so a
 * field the server adds and this file forgets is a compile error rather than a
 * value that silently never reaches the screen.
 */

const namedRefSchema = z.object({
  id: z.string(),
  name: z.string(),
}) satisfies z.ZodType<NamedRef>;

export const regularizationRequestSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  employeeCode: z.string(),
  date: z.string(),
  kind: z.enum(REGULARIZATION_KINDS),
  requestedIn: z.string().nullable(),
  requestedOut: z.string().nullable(),
  reason: z.string().nullable(),
  origin: z.enum(REGULARIZATION_ORIGINS),
  attachmentFileId: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  approvalRequestId: z.string().nullable(),
  raisedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: namedRefSchema.nullable(),
  decisionReason: z.string().nullable(),
}) satisfies z.ZodType<RegularizationRequest>;

export const onDutyRequestSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  employeeCode: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  reason: z.string(),
  siteName: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  approvalRequestId: z.string().nullable(),
  raisedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: namedRefSchema.nullable(),
  decisionReason: z.string().nullable(),
}) satisfies z.ZodType<OnDutyRequest>;

export const regularizationPolicySchema = z.object({
  windowDays: z.number().int(),
  maxPerMonth: z.number().int(),
  earliestDate: z.string(),
  today: z.string(),
  raisedThisMonth: z.number().int(),
  remainingThisMonth: z.number().int(),
}) satisfies z.ZodType<RegularizationPolicyView>;

/**
 * `PageMeta` carries page, pageSize and total — and nothing else.
 *
 * The first version of this required a `totalPages` the server has never sent,
 * and every list on the screen failed to parse while the request itself
 * answered 200. TypeScript could not see it: a schema that produces an *extra*
 * property still satisfies `z.ZodType<Paginated<T>>`, because the extra key is
 * assignable to the narrower type. It took driving the screen in a browser to
 * surface, which is the argument for parsing at the boundary rather than
 * trusting the annotation.
 */
const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export function paginatedSchema<T>(item: z.ZodType<T>): z.ZodType<Paginated<T>> {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}

/**
 * The status vocabulary is deliberately not redefined here.
 *
 * `features/approvals/types` already owns the words and the badge variants for
 * an `ApprovalStatus`, and leave imports its own identical copy of them. A
 * third copy is precisely the drift CLAUDE.md §3 rule 4 exists to stop: the
 * same status has to read the same on My Attendance, on this screen and in the
 * approvals inbox, and three maps cannot be relied on to stay in step.
 *
 * Re-exported rather than imported at each call site so the screens in this
 * folder have one place to look.
 */
export {
  APPROVAL_STATUS_LABELS as REQUEST_STATUS_LABELS,
  APPROVAL_STATUS_VARIANT as REQUEST_STATUS_VARIANT,
} from '@/features/approvals/types';

/**
 * `attendance.regularization_auto_file`'s draft: raised by the system, no
 * reason yet. Only the employee it is about ever sees one — the server hides
 * it from everyone else — so a row satisfying this always belongs to the
 * viewer and always needs their input before an approver can see it at all.
 */
export function isUncompletedDraft(row: RegularizationRequest): boolean {
  return row.origin === 'SYSTEM' && row.reason === null;
}
