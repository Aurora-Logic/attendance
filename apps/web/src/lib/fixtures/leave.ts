import type { ApprovalStatus, ApprovalType, Paginated } from '@vyuha/shared';

import type { ApprovalRequest } from '@/features/approvals/types';
import type { HolidayCalendar } from '@/features/holidays/types';
import type { LeaveBalance, LeaveRequest, LeaveTypePolicy } from '@/features/leave/types';

/**
 * Sample data for the Phase 2 screens, for development only.
 *
 * The leave, approval and holiday endpoints are not built yet. Rather than
 * ship four screens that can only be looked at in their error state, each
 * query falls back to this module when the endpoint answers "no such thing" —
 * and the screen then says out loud that it is showing samples (see
 * `dev-fixture-fallback.tsx`).
 *
 * Two rules hold this in place:
 *
 * 1. Nothing imports this module statically. The only reference is a dynamic
 *    `import()` inside an `import.meta.env.DEV` branch, which Vite folds to
 *    `false` in a production build and drops along with the import — so these
 *    rows cannot reach a deployed bundle (CLAUDE.md §6). There is a build
 *    assertion for it; see the report notes in `dev-fixture-fallback.tsx`.
 * 2. No real employee data. Names are placeholders and no record here
 *    corresponds to a person.
 *
 * Festival dates below are illustrative, not authoritative. REQ-H-04 has
 * holidays entered or imported by an administrator; nothing in this product
 * ships assumed dates (05-decisions §Holidays).
 */

function page<T>(rows: T[], pageNumber: number, pageSize: number, total: number): Paginated<T> {
  return { data: rows, meta: { page: pageNumber, pageSize, total } };
}

function slice<T>(rows: T[], pageNumber: number, pageSize: number): Paginated<T> {
  const start = (pageNumber - 1) * pageSize;
  return page(rows.slice(start, start + pageSize), pageNumber, pageSize, rows.length);
}

/** REQ-G-02 seed types, with the policy fields of REQ-G-01. */
const LEAVE_TYPES: LeaveTypePolicy[] = [
  {
    id: 'lt-cl',
    name: 'Casual Leave',
    code: 'CL',
    isPaid: true,
    accrualMethod: 'MONTHLY',
    annualEntitlement: 12,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 2,
    noticeDays: 1,
    allowsHalfDay: true,
    isEncashable: false,
    countsSandwichDays: false,
    minDays: null,
    maxDays: null,
    attachmentRequiredAfterDays: null,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
  },
  {
    id: 'lt-sl',
    name: 'Sick Leave',
    code: 'SL',
    isPaid: true,
    accrualMethod: 'YEARLY',
    annualEntitlement: 12,
    carryForwardAllowed: true,
    carryForwardCap: 6,
    negativeBalanceLimit: 3,
    noticeDays: 0,
    allowsHalfDay: true,
    isEncashable: false,
    countsSandwichDays: false,
    minDays: null,
    maxDays: null,
    attachmentRequiredAfterDays: null,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
  },
  {
    id: 'lt-el',
    name: 'Earned Leave',
    code: 'EL',
    isPaid: true,
    accrualMethod: 'MONTHLY',
    annualEntitlement: 18,
    carryForwardAllowed: true,
    carryForwardCap: 30,
    negativeBalanceLimit: 0,
    noticeDays: 7,
    allowsHalfDay: false,
    isEncashable: true,
    countsSandwichDays: true,
    minDays: null,
    maxDays: null,
    attachmentRequiredAfterDays: null,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
  },
  {
    id: 'lt-lwp',
    name: 'Leave Without Pay',
    code: 'LWP',
    isPaid: false,
    accrualMethod: 'NONE',
    annualEntitlement: 0,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 0,
    noticeDays: 3,
    allowsHalfDay: true,
    isEncashable: false,
    countsSandwichDays: true,
    minDays: null,
    maxDays: null,
    attachmentRequiredAfterDays: null,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
  },
  {
    id: 'lt-co',
    name: 'Compensatory Off',
    code: 'CO',
    isPaid: true,
    accrualMethod: 'NONE',
    annualEntitlement: 0,
    carryForwardAllowed: false,
    carryForwardCap: null,
    negativeBalanceLimit: 0,
    noticeDays: 1,
    allowsHalfDay: false,
    isEncashable: false,
    countsSandwichDays: false,
    minDays: null,
    maxDays: null,
    attachmentRequiredAfterDays: null,
    requiresTwoStepApproval: false,
    applicableEmploymentTypes: [],
    isActive: true,
  },
];

export function leaveTypesFixture(): Paginated<LeaveTypePolicy> {
  return page(LEAVE_TYPES, 1, LEAVE_TYPES.length, LEAVE_TYPES.length);
}

/**
 * One balance per type. Casual Leave is deliberately close to exhausted and
 * Compensatory Off is at zero, so the negative-balance path of REQ-G-08 can be
 * exercised on the apply form without editing this file.
 */
const BALANCES: Omit<LeaveBalance, 'leaveYear'>[] = [
  {
    leaveType: { id: 'lt-cl', name: 'Casual Leave', code: 'CL' },
    opening: 0,
    accrued: 5,
    availed: 4.5,
    adjusted: 0,
    carriedForward: 0,
    closing: 0.5,
  },
  {
    leaveType: { id: 'lt-sl', name: 'Sick Leave', code: 'SL' },
    opening: 6,
    accrued: 12,
    availed: 3,
    adjusted: 0,
    carriedForward: 6,
    closing: 15,
  },
  {
    leaveType: { id: 'lt-el', name: 'Earned Leave', code: 'EL' },
    opening: 11,
    accrued: 7.5,
    availed: 6,
    adjusted: -1,
    carriedForward: 11,
    closing: 11.5,
  },
  {
    leaveType: { id: 'lt-lwp', name: 'Leave Without Pay', code: 'LWP' },
    opening: 0,
    accrued: 0,
    availed: 2,
    adjusted: 0,
    carriedForward: 0,
    closing: -2,
  },
  {
    leaveType: { id: 'lt-co', name: 'Compensatory Off', code: 'CO' },
    opening: 0,
    accrued: 1,
    availed: 1,
    adjusted: 0,
    carriedForward: 0,
    closing: 0,
  },
];

export function leaveBalancesFixture(leaveYear: number): Paginated<LeaveBalance> {
  const rows = BALANCES.map((row) => ({ ...row, leaveYear }));
  return page(rows, 1, rows.length, rows.length);
}

const LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: 'lr-1041',
    leaveType: { id: 'lt-cl', name: 'Casual Leave', code: 'CL' },
    fromDate: '2026-08-24',
    toDate: '2026-08-25',
    totalDays: 2,
    reason: 'Family function out of town.',
    status: 'PENDING',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-08-11T09:14:00.000Z',
    decidedAt: '2026-08-11T09:14:00.000Z',
    decidedBy: { id: 'u-mgr', name: 'R. Iyer' },
    cancelledAt: null,
  },
  {
    id: 'lr-1038',
    leaveType: { id: 'lt-sl', name: 'Sick Leave', code: 'SL' },
    fromDate: '2026-08-03',
    toDate: '2026-08-03',
    totalDays: 0.5,
    reason: 'Dental appointment, second half.',
    status: 'APPROVED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-08-02T05:40:00.000Z',
    decidedAt: '2026-08-02T05:40:00.000Z',
    decidedBy: { id: 'u-mgr', name: 'R. Iyer' },
    cancelledAt: null,
  },
  {
    id: 'lr-1031',
    leaveType: { id: 'lt-el', name: 'Earned Leave', code: 'EL' },
    fromDate: '2026-07-13',
    toDate: '2026-07-17',
    totalDays: 5,
    reason: 'Annual holiday with family.',
    status: 'APPROVED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-06-28T11:02:00.000Z',
    decidedAt: '2026-06-28T11:02:00.000Z',
    decidedBy: { id: 'u-hr', name: 'S. Bhatt' },
    cancelledAt: null,
  },
  {
    id: 'lr-1027',
    leaveType: { id: 'lt-cl', name: 'Casual Leave', code: 'CL' },
    fromDate: '2026-06-19',
    toDate: '2026-06-19',
    totalDays: 1,
    reason: 'Personal work.',
    status: 'REJECTED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-06-18T14:20:00.000Z',
    decidedAt: '2026-06-18T14:20:00.000Z',
    decidedBy: { id: 'u-mgr', name: 'R. Iyer' },
    cancelledAt: null,
  },
  {
    id: 'lr-1022',
    leaveType: { id: 'lt-lwp', name: 'Leave Without Pay', code: 'LWP' },
    fromDate: '2026-05-26',
    toDate: '2026-05-27',
    totalDays: 2,
    reason: 'Extended travel after approved leave.',
    status: 'APPROVED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-05-19T06:55:00.000Z',
    decidedAt: '2026-05-19T06:55:00.000Z',
    decidedBy: { id: 'u-hr', name: 'S. Bhatt' },
    cancelledAt: null,
  },
  {
    id: 'lr-1018',
    leaveType: { id: 'lt-cl', name: 'Casual Leave', code: 'CL' },
    fromDate: '2026-05-08',
    toDate: '2026-05-08',
    totalDays: 1,
    reason: 'Cancelled — plans changed.',
    status: 'CANCELLED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-05-04T08:12:00.000Z',
    decidedAt: null,
    decidedBy: null,
    cancelledAt: null,
  },
  {
    id: 'lr-1009',
    leaveType: { id: 'lt-sl', name: 'Sick Leave', code: 'SL' },
    fromDate: '2026-04-21',
    toDate: '2026-04-22',
    totalDays: 2,
    reason: 'Viral fever, certificate attached.',
    status: 'APPROVED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-04-21T03:30:00.000Z',
    decidedAt: '2026-04-21T03:30:00.000Z',
    decidedBy: { id: 'u-mgr', name: 'R. Iyer' },
    cancelledAt: null,
  },
  {
    id: 'lr-1004',
    leaveType: { id: 'lt-el', name: 'Earned Leave', code: 'EL' },
    fromDate: '2026-04-06',
    toDate: '2026-04-06',
    totalDays: 1,
    reason: 'Awaiting HR after three days with the manager.',
    status: 'ESCALATED',
    employee: { id: 'e-self', name: 'You' },
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-04-01T10:05:00.000Z',
    decidedAt: '2026-04-01T10:05:00.000Z',
    decidedBy: { id: 'u-hr', name: 'S. Bhatt' },
    cancelledAt: null,
  },
];

export function leaveRequestsFixture(params: {
  page: number;
  pageSize: number;
  status: ApprovalStatus | null;
}): Paginated<LeaveRequest> {
  const rows = params.status
    ? LEAVE_REQUESTS.filter((row) => row.status === params.status)
    : LEAVE_REQUESTS;
  return slice(rows, params.page, params.pageSize);
}

const APPROVALS: ApprovalRequest[] = [
  {
    id: 'ap-2201',
    type: 'LEAVE',
    requester: { id: 'e-1004', name: 'A. Nair' },
    subject: 'Casual Leave, 24-08-2026 to 25-08-2026, 2 days',
    submittedAt: '2026-08-11T09:14:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2200',
    type: 'LEAVE',
    requester: { id: 'e-1011', name: 'B. Kulkarni' },
    subject: 'Earned Leave, 01-09-2026 to 05-09-2026, 5 days',
    submittedAt: '2026-08-11T07:02:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2198',
    type: 'REGULARIZATION',
    requester: { id: 'e-1017', name: 'C. Dsouza' },
    subject: 'Missing OUT punch on 07-08-2026, claimed 18:10',
    submittedAt: '2026-08-10T12:48:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2197',
    type: 'REGULARIZATION',
    requester: { id: 'e-1023', name: 'D. Menon' },
    subject: 'Forgot to punch on 06-08-2026, full day claimed',
    submittedAt: '2026-08-10T11:30:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2195',
    type: 'ON_DUTY',
    requester: { id: 'e-1031', name: 'E. Fernandes' },
    subject: 'Field duty, 12-08-2026 to 13-08-2026, client site Pune',
    submittedAt: '2026-08-09T16:20:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2192',
    type: 'FLAGGED_PUNCH',
    requester: { id: 'e-1040', name: 'F. Gupta' },
    subject: 'IN punch outside geofence on 08-08-2026 at 09:06',
    submittedAt: '2026-08-08T03:36:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2190',
    type: 'DEVICE_REBIND',
    requester: { id: 'e-1044', name: 'G. Haldar' },
    subject: 'New handset, previous device last seen 05-08-2026',
    submittedAt: '2026-08-07T05:10:00.000Z',
    currentStep: 1,
    status: 'PENDING',
  },
  {
    id: 'ap-2184',
    type: 'LEAVE',
    requester: { id: 'e-1050', name: 'H. Joshi' },
    subject: 'Sick Leave, 04-08-2026, half day',
    submittedAt: '2026-08-04T04:02:00.000Z',
    currentStep: 2,
    status: 'ESCALATED',
  },
  {
    id: 'ap-2176',
    type: 'LEAVE',
    requester: { id: 'e-1004', name: 'A. Nair' },
    subject: 'Casual Leave, 19-06-2026, 1 day',
    submittedAt: '2026-06-18T14:20:00.000Z',
    currentStep: 1,
    status: 'REJECTED',
  },
  {
    id: 'ap-2170',
    type: 'ON_DUTY',
    requester: { id: 'e-1031', name: 'E. Fernandes' },
    subject: 'Field duty, 02-06-2026, client site Nashik',
    submittedAt: '2026-05-30T09:45:00.000Z',
    currentStep: 1,
    status: 'APPROVED',
  },
  {
    id: 'ap-2166',
    type: 'REGULARIZATION',
    requester: { id: 'e-1011', name: 'B. Kulkarni' },
    subject: 'Wrong IN time on 21-05-2026, claimed 09:00',
    submittedAt: '2026-05-22T06:15:00.000Z',
    currentStep: 1,
    status: 'APPROVED',
  },
  {
    id: 'ap-2160',
    type: 'FLAGGED_PUNCH',
    requester: { id: 'e-1017', name: 'C. Dsouza' },
    subject: 'Offline sync punch on 15-05-2026, 41 minutes late',
    submittedAt: '2026-05-15T13:58:00.000Z',
    currentStep: 1,
    status: 'CANCELLED',
  },
];

export function approvalsFixture(params: {
  page: number;
  pageSize: number;
  type: ApprovalType | null;
  status: ApprovalStatus | null;
}): Paginated<ApprovalRequest> {
  const rows = APPROVALS.filter(
    (row) =>
      (params.type === null || row.type === params.type) &&
      (params.status === null || row.status === params.status),
  );
  return slice(rows, params.page, params.pageSize);
}

interface HolidaySeed {
  name: string;
  /** `MM-dd`; the year is applied by the generator. */
  monthDay: string;
  restricted: boolean;
}

const NATIONAL: HolidaySeed[] = [
  { name: 'Republic Day', monthDay: '01-26', restricted: false },
  { name: 'Independence Day', monthDay: '08-15', restricted: false },
  { name: 'Gandhi Jayanti', monthDay: '10-02', restricted: false },
  { name: 'Christmas Day', monthDay: '12-25', restricted: false },
];

const WEST: HolidaySeed[] = [
  { name: 'Gudi Padwa', monthDay: '03-19', restricted: false },
  { name: 'Maharashtra Day', monthDay: '05-01', restricted: false },
  { name: 'Ganesh Chaturthi', monthDay: '09-14', restricted: false },
  { name: 'Dussehra', monthDay: '10-20', restricted: false },
  { name: 'Diwali', monthDay: '11-08', restricted: false },
  { name: 'Bhai Dooj', monthDay: '11-10', restricted: true },
  { name: 'Good Friday', monthDay: '04-03', restricted: true },
];

const SOUTH: HolidaySeed[] = [
  { name: 'Ugadi', monthDay: '03-19', restricted: false },
  { name: 'Karnataka Rajyotsava', monthDay: '11-01', restricted: false },
  { name: 'Ayudha Puja', monthDay: '10-19', restricted: false },
  { name: 'Deepavali', monthDay: '11-08', restricted: false },
  { name: 'Onam', monthDay: '08-28', restricted: true },
  { name: 'Good Friday', monthDay: '04-03', restricted: true },
];

function buildCalendar(
  id: string,
  name: string,
  locations: string[],
  year: number,
  seeds: HolidaySeed[],
): HolidayCalendar {
  const holidays = [...NATIONAL, ...seeds]
    .map((seed) => ({
      id: `${id}-${String(year)}-${seed.monthDay}`,
      name: seed.name,
      date: `${String(year)}-${seed.monthDay}`,
      restricted: seed.restricted,
    }))
    // Sorted here rather than in the screen: a calendar out of date order
    // reads as a data error, and the server will send it sorted too.
    .sort((a, b) => a.date.localeCompare(b.date));
  return { id: `${id}-${String(year)}`, name, year, locations, holidays };
}

export function holidayCalendarsFixture(year: number): Paginated<HolidayCalendar> {
  const rows = [
    buildCalendar('hc-west', 'West India', ['Head office', 'Pune plant'], year, WEST),
    buildCalendar('hc-south', 'South India', ['Bengaluru office'], year, SOUTH),
  ];
  return page(rows, 1, rows.length, rows.length);
}
