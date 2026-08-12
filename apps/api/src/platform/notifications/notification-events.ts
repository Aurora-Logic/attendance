import type { NotificationChannel as NotificationChannelKey, PermissionKey } from '@vyuha/shared';

/**
 * The event catalogue from REQ-K-03, and the templates that turn one into
 * words.
 *
 * A call site emits an event type and a payload. It does not choose a channel,
 * does not know who receives it, and does not write any prose -- technical
 * design §12: "If a feature call site names a channel directly, it's wrong."
 *
 * Payloads are flat scalars. They are serialised into a BullMQ job and back,
 * so a `Date` would arrive as a string and an object would arrive without its
 * prototype. Ids and pre-formatted strings only; anything richer is looked up
 * by the renderer.
 */

export const NOTIFICATION_EVENTS = {
  PUNCH_REMINDER: 'punch.reminder',
  PUNCH_MISSING_OUT: 'punch.missing_out',
  PUNCH_FLAGGED: 'punch.flagged',

  LEAVE_APPLIED: 'leave.applied',
  LEAVE_APPROVED: 'leave.approved',
  LEAVE_REJECTED: 'leave.rejected',
  LEAVE_CANCELLED: 'leave.cancelled',
  LEAVE_BALANCE_LOW: 'leave.balance_low',

  REGULARIZATION_DECIDED: 'regularization.decided',
  APPROVAL_OVERDUE: 'approval.overdue',

  PERIOD_LOCKED: 'period.locked',
  PERIOD_UNLOCKED: 'period.unlocked',
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export type NotificationPayload = Readonly<Record<string, string | number | boolean | null>>;

/** Who a dispatch is for. Resolved to user accounts by `RecipientResolver`. */
export type NotificationAudience =
  | { readonly kind: 'users'; readonly userIds: readonly string[] }
  /** Employees, resolved to whichever of them have a login (REQ-B-02). */
  | { readonly kind: 'employees'; readonly employeeIds: readonly string[] }
  /** Everyone in the organisation holding a permission -- "notify HR". */
  | { readonly kind: 'permission'; readonly key: PermissionKey };

export interface NotificationTemplate {
  readonly title: (payload: NotificationPayload) => string;
  readonly body: (payload: NotificationPayload) => string;
  /** A path on the web client, or null when there is nothing to open. */
  readonly path: (payload: NotificationPayload) => string | null;
  /**
   * Where this event goes when the user has expressed no preference.
   *
   * An empty list means opt-in: nothing is delivered until the user creates a
   * `notification_preferences` row enabling it. REQ-K-03 marks the punch
   * reminder that way, and it is the only one -- a reminder before every shift
   * is the fastest way to teach a workforce to ignore the bell.
   */
  readonly defaultChannels: readonly NotificationChannelKey[];
}

const IN_APP_AND_EMAIL: readonly NotificationChannelKey[] = ['in_app', 'email'];
const IN_APP_ONLY: readonly NotificationChannelKey[] = ['in_app'];

function text(payload: NotificationPayload, key: string, fallback = ''): string {
  const value = payload[key];
  return value === undefined || value === null ? fallback : String(value);
}

function idPath(prefix: string, payload: NotificationPayload, key: string): string | null {
  const id = payload[key];
  return typeof id === 'string' && id.length > 0 ? `${prefix}/${id}` : null;
}

/**
 * `Record<NotificationEventType, ...>` on purpose: adding an event to the
 * catalogue without deciding what it says and where it goes is a compile
 * error, rather than a dispatch that silently renders as "undefined".
 */
export const NOTIFICATION_TEMPLATES: Record<NotificationEventType, NotificationTemplate> = {
  'punch.reminder': {
    title: () => 'Your shift starts soon',
    body: (p) => `Your ${text(p, 'shiftName', 'shift')} starts at ${text(p, 'startsAt')}.`,
    path: () => '/punch',
    defaultChannels: [],
  },
  'punch.missing_out': {
    title: () => 'You did not punch out',
    body: (p) =>
      `No punch out was recorded for ${text(p, 'date')}. Raise a regularization if you were at work.`,
    path: () => '/my-attendance',
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'punch.flagged': {
    title: () => 'A punch needs review',
    body: (p) =>
      `${text(p, 'employeeName', 'An employee')} recorded a punch on ${text(p, 'date')} flagged as ${text(p, 'flags', 'unusual')}.`,
    path: (p) => idPath('/punch-audit', p, 'punchId'),
    defaultChannels: IN_APP_ONLY,
  },

  'leave.applied': {
    title: (p) => `Leave request from ${text(p, 'employeeName', 'an employee')}`,
    body: (p) =>
      `${text(p, 'employeeName', 'An employee')} applied for ${text(p, 'leaveType', 'leave')} from ${text(p, 'fromDate')} to ${text(p, 'toDate')}.`,
    path: (p) => idPath('/approvals', p, 'approvalRequestId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'leave.approved': {
    title: () => 'Your leave was approved',
    body: (p) =>
      `${text(p, 'leaveType', 'Leave')} from ${text(p, 'fromDate')} to ${text(p, 'toDate')} was approved by ${text(p, 'approverName', 'your approver')}.`,
    path: (p) => idPath('/leave', p, 'leaveRequestId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'leave.rejected': {
    title: () => 'Your leave was not approved',
    body: (p) =>
      `${text(p, 'leaveType', 'Leave')} from ${text(p, 'fromDate')} to ${text(p, 'toDate')} was declined. Reason: ${text(p, 'reason', 'not given')}.`,
    path: (p) => idPath('/leave', p, 'leaveRequestId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'leave.cancelled': {
    title: () => 'A leave request was cancelled',
    body: (p) =>
      `${text(p, 'leaveType', 'Leave')} from ${text(p, 'fromDate')} to ${text(p, 'toDate')} was cancelled.`,
    path: (p) => idPath('/leave', p, 'leaveRequestId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'leave.balance_low': {
    title: (p) => `${text(p, 'leaveType', 'Leave')} balance is running low`,
    body: (p) =>
      `You have ${text(p, 'remainingDays', '0')} day(s) of ${text(p, 'leaveType', 'leave')} left this year.`,
    path: () => '/leave',
    defaultChannels: IN_APP_ONLY,
  },

  'regularization.decided': {
    title: (p) => `Regularization ${text(p, 'outcome', 'updated')}`,
    body: (p) =>
      `Your regularization for ${text(p, 'date')} was ${text(p, 'outcome', 'updated')}.`,
    path: (p) => idPath('/regularizations', p, 'regularizationId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },
  'approval.overdue': {
    title: () => 'An approval has been waiting too long',
    body: (p) =>
      `A ${text(p, 'approvalType', 'request')} has been pending for ${text(p, 'days', 'several')} day(s).`,
    path: (p) => idPath('/approvals', p, 'approvalRequestId'),
    defaultChannels: IN_APP_AND_EMAIL,
  },

  'period.locked': {
    title: () => 'An attendance period was locked',
    body: (p) => `${text(p, 'period')} was locked by ${text(p, 'actorName', 'an administrator')}.`,
    path: () => '/attendance/periods',
    defaultChannels: IN_APP_ONLY,
  },
  'period.unlocked': {
    title: () => 'An attendance period was unlocked',
    body: (p) =>
      `${text(p, 'period')} was unlocked by ${text(p, 'actorName', 'an administrator')}. Reason: ${text(p, 'reason', 'not given')}.`,
    path: () => '/attendance/periods',
    defaultChannels: IN_APP_ONLY,
  },
};
