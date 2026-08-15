import { z } from 'zod';

import { ATTENDANCE_STATUSES, PUNCH_TYPES } from './enums.js';
import { pageQuerySchema } from './pagination.js';

/**
 * Report definitions and export requests (REQ-J-01 to REQ-J-06).
 *
 * One shell serves every report (REQ-J-01), so the shell's vocabulary --
 * filters, columns, sort, saved views -- is defined once, here, and both ends
 * read the same definition. A screen cannot offer a column the exporter does
 * not know how to write, and the exporter cannot invent one the screen never
 * showed, because there is only one list.
 *
 * Every report REQ-J-01 names is defined here except REQ-J-04's payroll
 * handoff, which the client has dropped: it is not built and it is not stubbed,
 * because a report key that answers with an empty table is indistinguishable
 * from one whose period is quiet. Adding a report is a `REPORT_DEFINITIONS`
 * entry plus a row source; the exporter, the download tray and the filter bar
 * learn nothing new.
 */

// ------------------------------------------------------------------- reports

export const REPORT_KEYS = [
  'attendance-register',
  'daily-muster',
  'monthly-muster',
  'late-arrivals',
  'early-exits',
  'absenteeism',
  'missing-punch',
  'overtime',
  'leave-balance',
  'leave-ledger',
  'leave-availed',
  'punch-audit',
  'headcount',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

/**
 * How a value is rendered and aligned. The exporter uses it to decide a
 * column's width and whether the cell is text; the table uses it to decide
 * alignment and numerals (PRD §6.3).
 */
export const REPORT_COLUMN_TYPES = [
  'text',
  'code',
  'date',
  /** A wall-clock time to the minute, e.g. a scheduled shift boundary. */
  'time',
  /** A recorded moment, to the second. An audit line needs the seconds. */
  'instant',
  'duration',
  'number',
  'status',
  'flags',
] as const;

export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];

export interface ReportColumnSpec {
  readonly key: string;
  readonly header: string;
  readonly type: ReportColumnType;
  /**
   * Hidden below 1280px unless the reader turns it on (PRD §6.5: "non-essential
   * columns hidden via the column chooser default").
   */
  readonly secondary?: boolean;
  /** Off until the reader asks for it in the F12 chooser. */
  readonly defaultHidden?: boolean;
  /** Present when the server can order by this column. */
  readonly sortField?: string;
  /** Character width hint for the exported sheet (REQ-J-03, column widths). */
  readonly width?: number;
}

export interface ReportDefinition {
  readonly key: ReportKey;
  readonly label: string;
  readonly description: string;
  readonly columns: readonly ReportColumnSpec[];
  readonly defaultSort: string;
  /** Filters this report understands; the shell hides the rest. */
  readonly filters: readonly ReportFilterName[];
  /**
   * The period is one calendar date rather than a range.
   *
   * REQ-J-01's daily muster is "one row per employee **for a date**". The shell
   * renders a single-date picker for such a report and sends `from` equal to
   * `to`; the server reads `to` and would answer for that one day regardless,
   * so a hand-written URL asking for a range cannot produce a muster that
   * silently spans one.
   */
  readonly singleDate?: boolean;
  /**
   * The period must lie inside one calendar month.
   *
   * The muster grid's columns are days 1 to 31. A range crossing a month
   * boundary would put two different dates in the same column, so the server
   * refuses it rather than adding them together.
   */
  readonly singleMonth?: boolean;
}

export const REPORT_FILTER_NAMES = [
  'period',
  'employeeId',
  'departmentId',
  'locationId',
  'status',
  'flags',
  'punchType',
] as const;

export type ReportFilterName = (typeof REPORT_FILTER_NAMES)[number];

/**
 * REQ-E-01's register, one row per employee per day. The column set is the
 * `attendance_days` read model and nothing else -- notably no paid/unpaid
 * leave split and no LOP, which are REQ-J-04's payroll columns and are
 * unsigned-off (docs OPEN-QUESTIONS item 6).
 */
const ATTENDANCE_REGISTER_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'date', header: 'Date', type: 'date', sortField: 'date', width: 12 },
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 28 },
  { key: 'shiftName', header: 'Shift', type: 'text', width: 16 },
  { key: 'scheduledIn', header: 'Scheduled in', type: 'time', secondary: true, width: 13 },
  { key: 'scheduledOut', header: 'Scheduled out', type: 'time', secondary: true, width: 13 },
  { key: 'firstInAt', header: 'In', type: 'time', width: 8 },
  { key: 'lastOutAt', header: 'Out', type: 'time', width: 8 },
  { key: 'workedMinutes', header: 'Worked', type: 'duration', sortField: 'workedMinutes', width: 10 },
  { key: 'breakMinutes', header: 'Break', type: 'duration', secondary: true, width: 10 },
  { key: 'otMinutes', header: 'Overtime', type: 'duration', width: 10 },
  { key: 'lateMinutes', header: 'Late by', type: 'duration', secondary: true, width: 10 },
  { key: 'earlyExitMinutes', header: 'Early by', type: 'duration', secondary: true, width: 10 },
  { key: 'status', header: 'Status', type: 'status', sortField: 'status', width: 14 },
  { key: 'flags', header: 'Flags', type: 'flags', width: 22 },
  { key: 'isManualOverride', header: 'Overridden', type: 'text', defaultHidden: true, width: 12 },
  { key: 'locked', header: 'Locked', type: 'text', defaultHidden: true, width: 10 },
];

/** REQ-J-01's Punch Audit: "raw punch log with photo thumbnails, location, device, flags". */
const PUNCH_AUDIT_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'attendanceDate', header: 'Date', type: 'date', sortField: 'attendanceDate', width: 12 },
  { key: 'serverTime', header: 'Recorded at', type: 'instant', sortField: 'serverTime', width: 12 },
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 28 },
  { key: 'type', header: 'Direction', type: 'text', width: 10 },
  { key: 'source', header: 'Source', type: 'text', width: 14 },
  { key: 'clientTime', header: 'Device time', type: 'instant', secondary: true, width: 12 },
  { key: 'clockSkewSeconds', header: 'Clock skew', type: 'number', secondary: true, width: 12 },
  { key: 'syncDelaySeconds', header: 'Sync delay', type: 'number', secondary: true, width: 12 },
  { key: 'location', header: 'Location', type: 'text', width: 22 },
  { key: 'gpsAccuracyM', header: 'Accuracy', type: 'number', secondary: true, width: 10 },
  {
    key: 'distanceFromGeofenceM',
    header: 'From office',
    type: 'number',
    secondary: true,
    width: 12,
  },
  { key: 'halfDay', header: 'Half day', type: 'text', defaultHidden: true, width: 12 },
  { key: 'reason', header: 'Reason', type: 'text', width: 30 },
  { key: 'flags', header: 'Flags', type: 'flags', width: 26 },
];

/**
 * REQ-J-01's daily muster: "one row per employee for a date".
 *
 * The same rows as the register -- there is one `attendance_days` row per
 * employee per date and a second query over it would be a second answer to the
 * same question -- arranged for the sheet a supervisor prints in the morning:
 * ordered by employee code, with the date in the header block rather than
 * repeated down a column.
 */
const DAILY_MUSTER_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 28 },
  { key: 'shiftName', header: 'Shift', type: 'text', width: 16 },
  { key: 'scheduledIn', header: 'Scheduled in', type: 'time', secondary: true, width: 13 },
  { key: 'scheduledOut', header: 'Scheduled out', type: 'time', secondary: true, width: 13 },
  { key: 'firstInAt', header: 'In', type: 'time', width: 8 },
  { key: 'lastOutAt', header: 'Out', type: 'time', width: 8 },
  { key: 'workedMinutes', header: 'Worked', type: 'duration', sortField: 'workedMinutes', width: 10 },
  { key: 'breakMinutes', header: 'Break', type: 'duration', secondary: true, width: 10 },
  { key: 'otMinutes', header: 'Overtime', type: 'duration', width: 10 },
  { key: 'lateMinutes', header: 'Late by', type: 'duration', secondary: true, width: 10 },
  { key: 'earlyExitMinutes', header: 'Early by', type: 'duration', secondary: true, width: 10 },
  { key: 'status', header: 'Status', type: 'status', sortField: 'status', width: 14 },
  { key: 'flags', header: 'Flags', type: 'flags', width: 22 },
  { key: 'date', header: 'Date', type: 'date', sortField: 'date', defaultHidden: true, width: 12 },
];

// ------------------------------------------------------------- muster grid

/** Days 1 to 31, as the column keys the grid's cells are addressed by. */
export const MUSTER_GRID_DAYS = 31;

/** `d01` … `d31`. Zero-padded so the definition order is the calendar order. */
export function musterDayKey(day: number): string {
  return `d${String(day).padStart(2, '0')}`;
}

/**
 * REQ-J-01's "status codes" for the grid.
 *
 * A rendering of `attendance_days.status` and nothing more -- no status is
 * invented and none is merged, so a cell reading `A` is a row that says ABSENT.
 * Two letters where one would collide, because a muster read at arm's length is
 * read by shape.
 */
export const MUSTER_STATUS_CODES: Record<string, string> = {
  PRESENT: 'P',
  ABSENT: 'A',
  ON_LEAVE: 'L',
  HALF_DAY: 'HD',
  HOLIDAY: 'H',
  WEEKLY_OFF: 'WO',
  ON_DUTY: 'OD',
  PENDING: '?',
};

const MUSTER_GRID_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 26 },
  { key: 'departmentName', header: 'Department', type: 'text', secondary: true, width: 18 },
  ...Array.from({ length: MUSTER_GRID_DAYS }, (_, index) => ({
    key: musterDayKey(index + 1),
    header: String(index + 1),
    type: 'text' as const,
    width: 4,
  })),
  // REQ-J-01's "totals block". Columns rather than a trailing band of rows:
  // the exporter writes one header and one row shape, and a totals row inside
  // the data would be summed again by whoever opens the sheet.
  { key: 'presentDays', header: 'Present', type: 'number', sortField: 'presentDays', width: 9 },
  { key: 'absentDays', header: 'Absent', type: 'number', sortField: 'absentDays', width: 9 },
  { key: 'leaveDays', header: 'Leave', type: 'number', width: 9 },
  { key: 'halfDays', header: 'Half day', type: 'number', secondary: true, width: 9 },
  { key: 'onDutyDays', header: 'On duty', type: 'number', secondary: true, width: 9 },
  { key: 'weeklyOffDays', header: 'Weekly off', type: 'number', secondary: true, width: 11 },
  { key: 'holidayDays', header: 'Holiday', type: 'number', secondary: true, width: 9 },
  { key: 'workedMinutes', header: 'Worked', type: 'duration', sortField: 'workedMinutes', width: 10 },
  { key: 'otMinutes', header: 'Overtime', type: 'duration', width: 10 },
  { key: 'lateDays', header: 'Late days', type: 'number', width: 10 },
];

// ------------------------------------------------------- exception summaries

/**
 * Late arrivals, early exits and overtime are one query with one measure
 * swapped, so they are one column shape with the headers renamed.
 *
 * Keeping them as three definitions rather than one report with a mode is what
 * REQ-N-02's Ctrl+G expects: a Tally user switches to "Late arrivals", not to
 * "Exceptions" and then to a dropdown inside it.
 */
function exceptionColumns(labels: {
  occurrences: string;
  total: string;
  average: string;
  worst: string;
}): readonly ReportColumnSpec[] {
  return [
    { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
    { key: 'employeeName', header: 'Employee', type: 'text', width: 28 },
    { key: 'departmentName', header: 'Department', type: 'text', width: 18 },
    { key: 'locationName', header: 'Location', type: 'text', secondary: true, width: 16 },
    { key: 'occurrences', header: labels.occurrences, type: 'number', sortField: 'occurrences', width: 10 },
    { key: 'totalMinutes', header: labels.total, type: 'duration', sortField: 'totalMinutes', width: 12 },
    { key: 'averageMinutes', header: labels.average, type: 'duration', width: 12 },
    { key: 'worstMinutes', header: labels.worst, type: 'duration', sortField: 'worstMinutes', width: 12 },
    { key: 'firstDate', header: 'First', type: 'date', secondary: true, width: 12 },
    { key: 'lastDate', header: 'Last', type: 'date', secondary: true, width: 12 },
  ];
}

const ABSENTEEISM_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'month', header: 'Month', type: 'text', sortField: 'month', width: 10 },
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 28 },
  { key: 'departmentName', header: 'Department', type: 'text', width: 18 },
  { key: 'locationName', header: 'Location', type: 'text', secondary: true, width: 16 },
  { key: 'scheduledDays', header: 'Scheduled', type: 'number', width: 11 },
  { key: 'presentDays', header: 'Present', type: 'number', width: 9 },
  { key: 'leaveDays', header: 'On leave', type: 'number', secondary: true, width: 10 },
  { key: 'absentDays', header: 'Absent', type: 'number', sortField: 'absentDays', width: 9 },
  {
    key: 'absencePercent',
    header: 'Absent %',
    type: 'number',
    sortField: 'absencePercent',
    width: 10,
  },
];

const MISSING_PUNCH_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'date', header: 'Date', type: 'date', sortField: 'date', width: 12 },
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 26 },
  { key: 'departmentName', header: 'Department', type: 'text', secondary: true, width: 18 },
  { key: 'shiftName', header: 'Shift', type: 'text', secondary: true, width: 16 },
  // "Punched", not "In" and "Out": these are the raw punch times, and on a day
  // whose correction has been approved they differ from the register's, which
  // folds the adjustment in. Two columns with the same header and different
  // rules is how a reader ends up believing the two screens contradict.
  { key: 'punchedInAt', header: 'Punched in', type: 'time', width: 11 },
  { key: 'punchedOutAt', header: 'Punched out', type: 'time', width: 11 },
  { key: 'status', header: 'Status', type: 'status', sortField: 'status', width: 14 },
  { key: 'flags', header: 'Flags', type: 'flags', secondary: true, width: 22 },
  // REQ-J-01: "days flagged missing_punch, **and their regularization status**".
  // Null is the answer for a day nobody has raised a correction for, and it
  // renders as the empty dash rather than as "none", which would read as a
  // decision somebody made.
  { key: 'regularizationStatus', header: 'Correction', type: 'status', width: 14 },
  { key: 'regularizationKind', header: 'Kind', type: 'text', secondary: true, width: 14 },
  { key: 'regularizationDecidedAt', header: 'Decided', type: 'instant', secondary: true, width: 12 },
  { key: 'regularizationReason', header: 'Reason', type: 'text', defaultHidden: true, width: 30 },
];

// -------------------------------------------------------------------- leave

const LEAVE_BALANCE_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 26 },
  { key: 'departmentName', header: 'Department', type: 'text', secondary: true, width: 18 },
  { key: 'leaveTypeCode', header: 'Type', type: 'code', sortField: 'leaveTypeCode', width: 10 },
  { key: 'leaveTypeName', header: 'Leave type', type: 'text', width: 20 },
  { key: 'leaveYear', header: 'Leave year', type: 'number', secondary: true, width: 11 },
  { key: 'opening', header: 'Opening', type: 'number', secondary: true, width: 10 },
  { key: 'accrued', header: 'Accrued', type: 'number', width: 10 },
  { key: 'availed', header: 'Availed', type: 'number', sortField: 'availed', width: 10 },
  { key: 'adjusted', header: 'Adjusted', type: 'number', secondary: true, width: 10 },
  { key: 'carriedForward', header: 'Carried forward', type: 'number', secondary: true, width: 15 },
  { key: 'closing', header: 'Balance', type: 'number', sortField: 'closing', width: 10 },
];

const LEAVE_LEDGER_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'postedAt', header: 'Posted', type: 'instant', sortField: 'postedAt', width: 14 },
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 26 },
  { key: 'leaveTypeCode', header: 'Type', type: 'code', width: 10 },
  { key: 'leaveTypeName', header: 'Leave type', type: 'text', secondary: true, width: 20 },
  { key: 'leaveYear', header: 'Leave year', type: 'number', secondary: true, width: 11 },
  { key: 'movementType', header: 'Movement', type: 'status', sortField: 'movementType', width: 16 },
  { key: 'days', header: 'Days', type: 'number', sortField: 'days', width: 8 },
  { key: 'referenceType', header: 'Caused by', type: 'text', secondary: true, width: 16 },
  { key: 'periodKey', header: 'Period', type: 'text', defaultHidden: true, width: 12 },
  { key: 'note', header: 'Note', type: 'text', width: 30 },
];

const LEAVE_AVAILED_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'employeeCode', header: 'Code', type: 'code', sortField: 'employeeCode', width: 12 },
  { key: 'employeeName', header: 'Employee', type: 'text', width: 26 },
  { key: 'departmentName', header: 'Department', type: 'text', secondary: true, width: 18 },
  { key: 'leaveTypeCode', header: 'Type', type: 'code', sortField: 'leaveTypeCode', width: 10 },
  { key: 'leaveTypeName', header: 'Leave type', type: 'text', width: 20 },
  { key: 'isPaid', header: 'Paid', type: 'text', secondary: true, width: 8 },
  { key: 'requests', header: 'Requests', type: 'number', width: 10 },
  { key: 'days', header: 'Days', type: 'number', sortField: 'days', width: 8 },
  { key: 'firstDate', header: 'First', type: 'date', width: 12 },
  { key: 'lastDate', header: 'Last', type: 'date', width: 12 },
];

const HEADCOUNT_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'month', header: 'Month', type: 'text', sortField: 'month', width: 10 },
  { key: 'opening', header: 'Opening', type: 'number', width: 10 },
  { key: 'joiners', header: 'Joiners', type: 'number', sortField: 'joiners', width: 10 },
  { key: 'leavers', header: 'Leavers', type: 'number', sortField: 'leavers', width: 10 },
  { key: 'closing', header: 'Closing', type: 'number', sortField: 'closing', width: 10 },
];

/** The four filters every report over people understands. */
const PEOPLE_FILTERS: readonly ReportFilterName[] = [
  'period',
  'employeeId',
  'departmentId',
  'locationId',
];

export const REPORT_DEFINITIONS: Record<ReportKey, ReportDefinition> = {
  'attendance-register': {
    key: 'attendance-register',
    label: 'Attendance register',
    description: 'One row per employee per day: shift, in, out, hours, status and flags.',
    columns: ATTENDANCE_REGISTER_COLUMNS,
    defaultSort: '-date,employeeCode',
    filters: ['period', 'employeeId', 'departmentId', 'locationId', 'status', 'flags'],
  },
  'daily-muster': {
    key: 'daily-muster',
    label: 'Daily muster',
    description: 'One row per employee for a single date: shift, in, out, hours, status and flags.',
    columns: DAILY_MUSTER_COLUMNS,
    defaultSort: 'employeeCode',
    filters: ['period', 'employeeId', 'departmentId', 'locationId', 'status', 'flags'],
    singleDate: true,
  },
  'monthly-muster': {
    key: 'monthly-muster',
    label: 'Monthly muster grid',
    description: 'Employees against the days of one month, with a totals block.',
    columns: MUSTER_GRID_COLUMNS,
    defaultSort: 'employeeCode',
    filters: PEOPLE_FILTERS,
    singleMonth: true,
  },
  'late-arrivals': {
    key: 'late-arrivals',
    label: 'Late arrivals',
    description: 'Days recorded late, with the minutes, gathered per employee.',
    columns: exceptionColumns({
      occurrences: 'Late days',
      total: 'Total late',
      average: 'Average late',
      worst: 'Worst late',
    }),
    defaultSort: '-totalMinutes',
    filters: PEOPLE_FILTERS,
  },
  'early-exits': {
    key: 'early-exits',
    label: 'Early exits',
    description: 'Days that ended early, with the minutes, gathered per employee.',
    columns: exceptionColumns({
      occurrences: 'Early exits',
      total: 'Total early',
      average: 'Average early',
      worst: 'Worst early',
    }),
    defaultSort: '-totalMinutes',
    filters: PEOPLE_FILTERS,
  },
  absenteeism: {
    key: 'absenteeism',
    label: 'Absenteeism',
    description: 'Absent days and the share of scheduled days they are, by employee and month.',
    columns: ABSENTEEISM_COLUMNS,
    defaultSort: '-absencePercent',
    filters: PEOPLE_FILTERS,
  },
  'missing-punch': {
    key: 'missing-punch',
    label: 'Missing punch',
    description: 'Days flagged for a missing punch, and where their correction stands.',
    columns: MISSING_PUNCH_COLUMNS,
    defaultSort: '-date,employeeCode',
    filters: PEOPLE_FILTERS,
  },
  overtime: {
    key: 'overtime',
    label: 'Overtime',
    description: 'Overtime minutes by employee for the period. Minutes only, never money.',
    columns: exceptionColumns({
      occurrences: 'OT days',
      total: 'Total overtime',
      average: 'Average per day',
      worst: 'Longest day',
    }),
    defaultSort: '-totalMinutes',
    filters: PEOPLE_FILTERS,
  },
  'leave-balance': {
    key: 'leave-balance',
    label: 'Leave balance',
    description: 'Balances by employee and leave type for the leave year the period falls in.',
    columns: LEAVE_BALANCE_COLUMNS,
    defaultSort: 'employeeCode,leaveTypeCode',
    filters: PEOPLE_FILTERS,
  },
  'leave-ledger': {
    key: 'leave-ledger',
    label: 'Leave ledger',
    description: 'Every leave movement posted in the period. Filter to one employee for a history.',
    columns: LEAVE_LEDGER_COLUMNS,
    defaultSort: '-postedAt',
    filters: PEOPLE_FILTERS,
  },
  'leave-availed': {
    key: 'leave-availed',
    label: 'Leave availed',
    description: 'Approved leave days falling inside the period, by employee and type.',
    columns: LEAVE_AVAILED_COLUMNS,
    defaultSort: '-days',
    filters: PEOPLE_FILTERS,
  },
  'punch-audit': {
    key: 'punch-audit',
    label: 'Punch audit',
    description: 'The raw punch log with photo, location, device and flags.',
    columns: PUNCH_AUDIT_COLUMNS,
    defaultSort: '-serverTime',
    filters: ['period', 'employeeId', 'departmentId', 'locationId', 'punchType'],
  },
  headcount: {
    key: 'headcount',
    label: 'Headcount',
    description: 'Opening headcount, joiners, leavers and closing headcount by month.',
    columns: HEADCOUNT_COLUMNS,
    defaultSort: 'month',
    filters: ['departmentId', 'locationId', 'period'],
  },
};

export const ALL_REPORTS: readonly ReportDefinition[] = REPORT_KEYS.map(
  (key) => REPORT_DEFINITIONS[key],
);

/** The columns a report shows before anyone touches the F12 chooser. */
export function defaultVisibleColumns(reportKey: ReportKey): string[] {
  return REPORT_DEFINITIONS[reportKey].columns
    .filter((column) => column.defaultHidden !== true)
    .map((column) => column.key);
}

/**
 * The chosen columns, in the report's own order, with anything unknown
 * dropped.
 *
 * Ordering by the definition rather than by the request is deliberate: a saved
 * view written against an older column set must not be able to reorder a sheet
 * that payroll or an auditor reads positionally, and an unknown key is a stale
 * bookmark rather than a reason to refuse.
 *
 * An empty or absent selection means the default set. A request that resolves
 * to nothing at all would produce a file with a header row and no columns.
 */
export function resolveColumns(
  reportKey: ReportKey,
  chosen: readonly string[] | undefined,
): ReportColumnSpec[] {
  const all = REPORT_DEFINITIONS[reportKey].columns;
  if (chosen === undefined || chosen.length === 0) {
    return all.filter((column) => column.defaultHidden !== true);
  }
  const wanted = new Set(chosen);
  const resolved = all.filter((column) => wanted.has(column.key));
  return resolved.length === 0 ? all.filter((column) => column.defaultHidden !== true) : resolved;
}

/** Sort fields the server will honour for a report; anything else is dropped. */
export function sortableFields(reportKey: ReportKey): string[] {
  const fields: string[] = [];
  for (const column of REPORT_DEFINITIONS[reportKey].columns) {
    if (column.sortField !== undefined) fields.push(column.sortField);
  }
  return fields;
}

// ------------------------------------------------------------------- filters

/**
 * The REQ-J-01 filter bar, as a query. Every field is optional here because
 * this is also the shape a saved view stores; the export request narrows it.
 */
export const reportFilterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  employeeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  /** Comma-separated `ATTENDANCE_FLAGS`; a row matching any of them is kept. */
  flags: z.string().max(200).optional(),
  punchType: z.enum(PUNCH_TYPES).optional(),
});

export type ReportFilters = z.infer<typeof reportFilterSchema>;

/**
 * NFR-03 sizes the export job at "a full month for 500 employees". A year is
 * the outer bound this refuses past -- not because the query cannot do it, but
 * because an unbounded range is almost always a filter someone forgot to set,
 * and the honest answer is to say so rather than to spend ten minutes on it.
 */
export const MAX_EXPORT_RANGE_DAYS = 366;

/** Beyond this the job fails with an ask to narrow, before it writes anything. */
export const MAX_EXPORT_ROWS = 100_000;

/** REQ-J-03: "a 7-day retention", honoured through `files.expires_at`. */
export const EXPORT_RETENTION_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inclusive day count, or null when either end is not a calendar date. */
export function rangeLengthInDays(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / MILLISECONDS_PER_DAY) + 1;
}

/**
 * An export always names its period. A screen may browse unbounded, but a file
 * that lands in somebody's downloads has to say what it covers, and the header
 * block in REQ-J-03 has nothing to print otherwise.
 */
export const exportFilterSchema = reportFilterSchema
  .extend({ from: z.iso.date(), to: z.iso.date() })
  .superRefine((value, ctx) => {
    const days = rangeLengthInDays(value.from, value.to);
    if (days === null || days < 1) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'must not be before the start date' });
      return;
    }
    if (days > MAX_EXPORT_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `a period may cover at most ${String(MAX_EXPORT_RANGE_DAYS)} days`,
      });
    }
  });

export type ExportFilters = z.infer<typeof exportFilterSchema>;

/** The row query behind the shell: filters, paging and sort in one object. */
export const reportRowQuerySchema = pageQuerySchema.extend({
  ...reportFilterSchema.shape,
  sort: z.string().max(200).optional(),
});

export type ReportRowQuery = z.infer<typeof reportRowQuerySchema>;

/**
 * The filter block printed at the top of an exported file (REQ-J-03) and
 * beside the toolbar on screen. Labels are resolved by the caller because only
 * it knows an employee's name for an id.
 */
export interface FilterCaption {
  readonly label: string;
  readonly value: string;
}

export function describeFilters(
  filters: ReportFilters,
  names: Readonly<Record<string, string>> = {},
): FilterCaption[] {
  const captions: FilterCaption[] = [];
  const named = (id: string): string => names[id] ?? id;

  if (filters.from !== undefined && filters.from === filters.to) {
    // The daily muster's period is one day. "02-03-2026 to 02-03-2026" is true
    // and reads as a mistake, at the top of a file somebody prints.
    captions.push({ label: 'Date', value: filters.from });
  } else if (filters.from !== undefined || filters.to !== undefined) {
    captions.push({
      label: 'Period',
      value: `${filters.from ?? 'any'} to ${filters.to ?? 'any'}`,
    });
  }
  if (filters.employeeId !== undefined) {
    captions.push({ label: 'Employee', value: named(filters.employeeId) });
  }
  if (filters.departmentId !== undefined) {
    captions.push({ label: 'Department', value: named(filters.departmentId) });
  }
  if (filters.locationId !== undefined) {
    captions.push({ label: 'Location', value: named(filters.locationId) });
  }
  if (filters.status !== undefined) captions.push({ label: 'Status', value: filters.status });
  if (filters.flags !== undefined && filters.flags.length > 0) {
    captions.push({ label: 'Flags', value: filters.flags });
  }
  if (filters.punchType !== undefined) {
    captions.push({ label: 'Direction', value: filters.punchType });
  }

  // Never an empty block: "everything" is a fact about the file worth stating.
  if (captions.length === 0) captions.push({ label: 'Filters', value: 'none' });
  return captions;
}

// -------------------------------------------------------------------- export

/**
 * XLSX is the requirement (REQ-J-03) and is not yet buildable: no spreadsheet
 * library is a dependency of the API, and CLAUDE.md §6 forbids adding one
 * without asking. CSV is written through the same writer interface, so the
 * second entry here becomes real by adding a writer and a dependency -- not by
 * reworking the job, the tray, or this contract.
 */
export const EXPORT_FORMATS = ['CSV', 'XLSX'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * What the API will actually produce today.
 *
 * Both formats now have a writer. This list stays separate from
 * `EXPORT_FORMATS` because it is the one the request schema validates against:
 * a format may be named in the contract long before anything can write it, and
 * accepting a request for one that cannot be written produces a job that fails
 * after the user has walked away.
 */
export const AVAILABLE_EXPORT_FORMATS = ['XLSX', 'CSV'] as const satisfies readonly ExportFormat[];

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  CSV: 'CSV',
  XLSX: 'Excel',
};

export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  CSV: 'csv',
  XLSX: 'xlsx',
};

export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;

export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Preparing',
  DONE: 'Ready',
  FAILED: 'Failed',
};

export const exportRequestSchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
  filters: exportFilterSchema,
  /** Column keys to include. Unknown ones are dropped, not refused. */
  columns: z.array(z.string().max(64)).max(64).optional(),
  sort: z.string().max(200).optional(),
  format: z.enum(AVAILABLE_EXPORT_FORMATS).default('CSV'),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;

export interface ExportJobSummary {
  readonly id: string;
  readonly reportKey: string;
  readonly reportLabel: string;
  readonly status: ExportStatus;
  readonly format: ExportFormat;
  readonly filename: string;
  /** 0 to 100. Meaningful while RUNNING; 100 once DONE. */
  readonly progress: number;
  readonly rowCount: number | null;
  /** Set only on FAILED, and safe to render: it never carries a stack trace. */
  readonly error: string | null;
  readonly filters: ReportFilters;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** REQ-J-03's retention. Null before the file exists. */
  readonly expiresAt: string | null;
  /** False once the file has expired or been purged, even while status is DONE. */
  readonly downloadable: boolean;
}

export interface ExportDownload {
  readonly url: string;
  readonly expiresInSeconds: number;
  readonly filename: string;
}

/** `attendance-register-2026-08-13-1423.csv`. Stable, sortable, no spaces. */
export function exportFileName(
  reportKey: string,
  generatedAt: Date,
  format: ExportFormat,
): string {
  const stamp = generatedAt
    .toISOString()
    .replace(/[:T]/gu, '-')
    .slice(0, 16)
    .replace(/-(\d{2})-(\d{2})$/u, '-$1$2');
  return `${reportKey}-${stamp}.${EXPORT_FORMAT_EXTENSIONS[format]}`;
}

// --------------------------------------------------------------- saved views

export const SAVED_VIEW_NAME_MAX = 60;

export const savedViewConfigSchema = z.object({
  filters: reportFilterSchema.default({}),
  columns: z.array(z.string().max(64)).max(64).default([]),
  sort: z.string().max(200).optional(),
});

export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>;

export const savedViewInputSchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX),
  config: savedViewConfigSchema,
  /** REQ-J-01 saved views are personal by default; sharing is opt-in. */
  isShared: z.boolean().default(false),
});

export type SavedViewInput = z.infer<typeof savedViewInputSchema>;

export const savedViewQuerySchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
});

export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;

export interface SavedView {
  readonly id: string;
  readonly reportKey: string;
  readonly name: string;
  readonly config: SavedViewConfig;
  readonly isShared: boolean;
  /** False when it belongs to somebody else and was shared with the caller. */
  readonly isOwn: boolean;
  readonly createdAt: string;
}

// ----------------------------------------------------------------- row access

/**
 * One cell, before anybody decides how to write it.
 *
 * The extractors below answer "what is in this column" and stop there. The
 * table renders a duration as `8h 12m` and the sheet writes it as `08:12`, and
 * both are right -- but only if they are reading the same value out of the
 * same row. Returning a formatted string here is how the screen and the file
 * start disagreeing about what a column contains.
 */
export type ReportCellValue = string | number | boolean | null | readonly string[];

/**
 * The register's cells, from the `GET /attendance/days` read model.
 *
 * Structurally typed rather than importing `AttendanceDaySummary`: the
 * extractor needs the fields it names and nothing else, and stating that keeps
 * a report from silently depending on the whole day contract.
 */
export interface AttendanceRegisterSource {
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly date: string;
  readonly status: string;
  readonly shift: { readonly name: string } | null;
  readonly scheduledIn: string | null;
  readonly scheduledOut: string | null;
  readonly firstInAt: string | null;
  readonly lastOutAt: string | null;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  /** Optional for the reason `AttendanceDaySummary.otMinutes` is: a viewer who
   * may not see overtime is sent a row without the key at all. Reports are
   * gated on `report.view`, which no self-only account holds, so in practice
   * the register always has it -- but the extractor must not assume a field
   * the source type no longer guarantees. */
  readonly otMinutes?: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly flags: readonly string[];
  readonly isManualOverride: boolean;
  readonly locked: boolean;
}

export function attendanceRegisterCell(
  row: AttendanceRegisterSource,
  key: string,
): ReportCellValue {
  switch (key) {
    case 'date':
      return row.date;
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'shiftName':
      return row.shift?.name ?? null;
    case 'scheduledIn':
      return row.scheduledIn;
    case 'scheduledOut':
      return row.scheduledOut;
    case 'firstInAt':
      return row.firstInAt;
    case 'lastOutAt':
      return row.lastOutAt;
    case 'workedMinutes':
      return row.workedMinutes;
    case 'breakMinutes':
      return row.breakMinutes;
    case 'otMinutes':
      // Null, not zero: a withheld overtime figure renders as the empty-value
      // dash, the same as any column with nothing in it. Zero would read as
      // "worked no overtime", which is a claim this row is not making.
      return row.otMinutes ?? null;
    case 'lateMinutes':
      return row.lateMinutes;
    case 'earlyExitMinutes':
      return row.earlyExitMinutes;
    case 'status':
      return row.status;
    case 'flags':
      return row.flags;
    case 'isManualOverride':
      return row.isManualOverride;
    case 'locked':
      return row.locked;
    default:
      // A column key with no extractor is a definition and an extractor that
      // have drifted. Null renders as the empty-value dash rather than as
      // `undefined` in a payroll-adjacent file.
      return null;
  }
}

/** The punch audit's cells, from the `GET /punches` read model. */
export interface PunchAuditSource {
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly attendanceDate: string;
  readonly type: string;
  readonly serverTime: string;
  readonly clientTime: string | null;
  readonly clockSkewSeconds: number | null;
  readonly syncDelaySeconds: number | null;
  readonly source: string;
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyM: number | null;
    readonly distanceFromGeofenceM: number | null;
  } | null;
  readonly isHalfDayMarked: boolean;
  readonly halfDayPart: string | null;
  readonly reason: string | null;
  readonly flags: readonly string[];
}

/** Five decimal places is about a metre; more is false precision from a phone. */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function punchAuditCell(row: PunchAuditSource, key: string): ReportCellValue {
  switch (key) {
    case 'attendanceDate':
      return row.attendanceDate;
    case 'serverTime':
      return row.serverTime;
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'type':
      return row.type;
    case 'source':
      return row.source;
    case 'clientTime':
      return row.clientTime;
    case 'clockSkewSeconds':
      return row.clockSkewSeconds;
    case 'syncDelaySeconds':
      return row.syncDelaySeconds;
    case 'location':
      return row.location === null
        ? null
        : formatCoordinates(row.location.latitude, row.location.longitude);
    case 'gpsAccuracyM':
      return row.location?.accuracyM ?? null;
    case 'distanceFromGeofenceM':
      return row.location?.distanceFromGeofenceM ?? null;
    case 'halfDay':
      return row.isHalfDayMarked ? (row.halfDayPart ?? 'yes') : null;
    case 'reason':
      return row.reason;
    case 'flags':
      return row.flags;
    default:
      return null;
  }
}

// ------------------------------------------------- derived report row sources

/**
 * Every row below is produced by a query written for its report, so unlike the
 * register and the audit -- which are the muster and the punch feed's own read
 * models -- these shapes exist only here. That is the point: a report that
 * aggregates has no other consumer, and giving it a shape of its own is what
 * stops somebody reaching for it as though it were the record.
 *
 * `id` on each is a row key, not a record id. A grouped row is not an entity
 * and has no id of its own; the table needs something stable to key on and the
 * server composes one from the group.
 */

/** REQ-J-01's monthly grid: one employee, the days of one month, and totals. */
export interface MusterGridSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  /** `d01` … `d31` to a `MUSTER_STATUS_CODES` value, or absent for no such day. */
  readonly days: Readonly<Record<string, string | null>>;
  readonly presentDays: number;
  readonly absentDays: number;
  readonly leaveDays: number;
  readonly halfDays: number;
  readonly onDutyDays: number;
  readonly weeklyOffDays: number;
  readonly holidayDays: number;
  readonly workedMinutes: number;
  readonly otMinutes: number;
  readonly lateDays: number;
}

const MUSTER_DAY_KEY = /^d(0[1-9]|[12]\d|3[01])$/u;

export function musterGridCell(row: MusterGridSource, key: string): ReportCellValue {
  if (MUSTER_DAY_KEY.test(key)) return row.days[key] ?? null;

  switch (key) {
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'presentDays':
      return row.presentDays;
    case 'absentDays':
      return row.absentDays;
    case 'leaveDays':
      return row.leaveDays;
    case 'halfDays':
      return row.halfDays;
    case 'onDutyDays':
      return row.onDutyDays;
    case 'weeklyOffDays':
      return row.weeklyOffDays;
    case 'holidayDays':
      return row.holidayDays;
    case 'workedMinutes':
      return row.workedMinutes;
    case 'otMinutes':
      return row.otMinutes;
    case 'lateDays':
      return row.lateDays;
    default:
      return null;
  }
}

/**
 * Late arrivals, early exits and overtime.
 *
 * One shape for three reports because it is one question -- how often, how
 * much, how bad -- asked of three columns of `attendance_days`. The measure is
 * named by the report's own headers, so nothing here has to know which one it
 * is holding.
 */
export interface AttendanceExceptionSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly locationName: string | null;
  /** Days on which the measure was non-zero. */
  readonly occurrences: number;
  readonly totalMinutes: number;
  readonly averageMinutes: number;
  readonly worstMinutes: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
}

export function attendanceExceptionCell(
  row: AttendanceExceptionSource,
  key: string,
): ReportCellValue {
  switch (key) {
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'locationName':
      return row.locationName;
    case 'occurrences':
      return row.occurrences;
    case 'totalMinutes':
      return row.totalMinutes;
    case 'averageMinutes':
      return row.averageMinutes;
    case 'worstMinutes':
      return row.worstMinutes;
    case 'firstDate':
      return row.firstDate;
    case 'lastDate':
      return row.lastDate;
    default:
      return null;
  }
}

/** REQ-J-01's absenteeism: "absent days and percentage by employee, department, month". */
export interface AbsenteeismSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly locationName: string | null;
  /** `YYYY-MM`. */
  readonly month: string;
  /** Days the person was expected: every day that is not a weekly off or holiday. */
  readonly scheduledDays: number;
  readonly presentDays: number;
  readonly leaveDays: number;
  readonly absentDays: number;
  /** Absent days over scheduled days, to one decimal. A share, not a rate. */
  readonly absencePercent: number;
}

export function absenteeismCell(row: AbsenteeismSource, key: string): ReportCellValue {
  switch (key) {
    case 'month':
      return row.month;
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'locationName':
      return row.locationName;
    case 'scheduledDays':
      return row.scheduledDays;
    case 'presentDays':
      return row.presentDays;
    case 'leaveDays':
      return row.leaveDays;
    case 'absentDays':
      return row.absentDays;
    case 'absencePercent':
      return row.absencePercent;
    default:
      return null;
  }
}

/** REQ-J-01's missing punch: the flagged day, and where its correction stands. */
export interface MissingPunchSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly date: string;
  readonly status: string;
  readonly shiftName: string | null;
  /** The punches as recorded, before any approved correction (REQ-F-03). */
  readonly punchedInAt: string | null;
  readonly punchedOutAt: string | null;
  readonly flags: readonly string[];
  /** Null when nobody has raised one -- not "NONE", which would read as a decision. */
  readonly regularizationStatus: string | null;
  readonly regularizationKind: string | null;
  readonly regularizationDecidedAt: string | null;
  readonly regularizationReason: string | null;
}

export function missingPunchCell(row: MissingPunchSource, key: string): ReportCellValue {
  switch (key) {
    case 'date':
      return row.date;
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'shiftName':
      return row.shiftName;
    case 'punchedInAt':
      return row.punchedInAt;
    case 'punchedOutAt':
      return row.punchedOutAt;
    case 'status':
      return row.status;
    case 'flags':
      return row.flags;
    case 'regularizationStatus':
      return row.regularizationStatus;
    case 'regularizationKind':
      return row.regularizationKind;
    case 'regularizationDecidedAt':
      return row.regularizationDecidedAt;
    case 'regularizationReason':
      return row.regularizationReason;
    default:
      return null;
  }
}

/** REQ-J-01's leave balance: `leave_balances`, which is the ledger's own cache. */
export interface LeaveBalanceSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly leaveYear: number;
  readonly opening: number;
  readonly accrued: number;
  readonly availed: number;
  readonly adjusted: number;
  readonly carriedForward: number;
  readonly closing: number;
}

export function leaveBalanceCell(row: LeaveBalanceSource, key: string): ReportCellValue {
  switch (key) {
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'leaveTypeCode':
      return row.leaveTypeCode;
    case 'leaveTypeName':
      return row.leaveTypeName;
    case 'leaveYear':
      return row.leaveYear;
    case 'opening':
      return row.opening;
    case 'accrued':
      return row.accrued;
    case 'availed':
      return row.availed;
    case 'adjusted':
      return row.adjusted;
    case 'carriedForward':
      return row.carriedForward;
    case 'closing':
      return row.closing;
    default:
      return null;
  }
}

/** REQ-J-01's leave ledger: `leave_ledger`, which REQ-G-03 makes append-only. */
export interface LeaveLedgerSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly leaveYear: number;
  readonly postedAt: string;
  readonly movementType: string;
  /** Signed, as stored: an AVAILED movement is negative. */
  readonly days: number;
  readonly referenceType: string | null;
  readonly periodKey: string | null;
  readonly note: string | null;
}

export function leaveLedgerCell(row: LeaveLedgerSource, key: string): ReportCellValue {
  switch (key) {
    case 'postedAt':
      return row.postedAt;
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'leaveTypeCode':
      return row.leaveTypeCode;
    case 'leaveTypeName':
      return row.leaveTypeName;
    case 'leaveYear':
      return row.leaveYear;
    case 'movementType':
      return row.movementType;
    case 'days':
      return row.days;
    case 'referenceType':
      return row.referenceType;
    case 'periodKey':
      return row.periodKey;
    case 'note':
      return row.note;
    default:
      return null;
  }
}

/** REQ-J-01's leave availed: approved leave *days* that fall inside the period. */
export interface LeaveAvailedSource {
  readonly id: string;
  readonly employee: { readonly name: string };
  readonly employeeCode: string;
  readonly departmentName: string | null;
  readonly leaveTypeCode: string;
  readonly leaveTypeName: string;
  readonly isPaid: boolean;
  readonly requests: number;
  readonly days: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
}

export function leaveAvailedCell(row: LeaveAvailedSource, key: string): ReportCellValue {
  switch (key) {
    case 'employeeCode':
      return row.employeeCode;
    case 'employeeName':
      return row.employee.name;
    case 'departmentName':
      return row.departmentName;
    case 'leaveTypeCode':
      return row.leaveTypeCode;
    case 'leaveTypeName':
      return row.leaveTypeName;
    case 'isPaid':
      return row.isPaid;
    case 'requests':
      return row.requests;
    case 'days':
      return row.days;
    case 'firstDate':
      return row.firstDate;
    case 'lastDate':
      return row.lastDate;
    default:
      return null;
  }
}

/**
 * REQ-J-01's headcount: "active headcount, joiners, leavers by month".
 *
 * Every figure comes from `date_of_joining` and `date_of_leaving`, which are
 * the only two dates the employee record actually holds. `employees.status` is
 * a current fact with no history behind it, so it is not read here -- a person
 * marked inactive today would otherwise rewrite what March's headcount was.
 */
export interface HeadcountSource {
  readonly id: string;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly opening: number;
  readonly joiners: number;
  readonly leavers: number;
  readonly closing: number;
}

export function headcountCell(row: HeadcountSource, key: string): ReportCellValue {
  switch (key) {
    case 'month':
      return row.month;
    case 'opening':
      return row.opening;
    case 'joiners':
      return row.joiners;
    case 'leavers':
      return row.leavers;
    case 'closing':
      return row.closing;
    default:
      return null;
  }
}
