import { z } from 'zod';

import { ATTENDANCE_STATUSES, PUNCH_TYPES } from './enums.js';
import type { NamedRef } from './people.js';
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
  // Phase 6c (REQ-S-05): the Tally module's first report. Listed with the
  // rest so ReportKey stays one union; grouped separately below.
  'voucher-reconciliation',
  'customer-statement',
  'credit-cycle',
  'sales-analysis',
  'pending-dispatch',
  'low-stock',
  // 14 Tier 1: the projection mirrors and the first analysis (REQ-AE-01, REQ-AG-02).
  'day-book',
  'customer-lapse',
  // 14 Tier 1, the rest (D-46): mirrors, analyses and exceptions from the projection.
  'ledger-extract',
  'stock-summary',
  'negative-stock',
  'stale-projections',
  'duplicate-masters',
  'customer-item-matrix',
  'purchase-rhythm',
  'price-variance',
  'item-velocity',
  'dead-stock',
  'movement-analysis',
  'vendor-item-history',
  'vendor-price-comparison',
  'credit-breaches',
  'stock-ageing',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/** The keys the Tally module's source claims; everything else is attendance's. */
export const TALLY_REPORT_KEYS = ['voucher-reconciliation', 'customer-statement', 'credit-cycle', 'sales-analysis', 'low-stock', 'day-book', 'customer-lapse'] as const satisfies readonly ReportKey[];
/** 14 Tier 1 (D-46), served by the analytics source; the same receivables gate as the Tally set. */
export const ANALYTICS_REPORT_KEYS = [
  'ledger-extract',
  'stock-summary',
  'negative-stock',
  'stale-projections',
  'duplicate-masters',
  'customer-item-matrix',
  'purchase-rhythm',
  'price-variance',
  'item-velocity',
  'dead-stock',
  'movement-analysis',
  'vendor-item-history',
  'vendor-price-comparison',
  'credit-breaches',
  'stock-ageing',
] as const satisfies readonly ReportKey[];
/** The sales module's reports (12 REQ-AA-30). */
export const SALES_REPORT_KEYS = ['pending-dispatch'] as const satisfies readonly ReportKey[];

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
   * Filters without which the report has no answer — a customer statement
   * is for one party. The shell asks before it fetches, rather than fetching
   * a 400 and rendering it as an error.
   */
  readonly requiredFilters?: readonly ReportFilterName[];
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
  /** Phase 6d: the receivables reports are about a party (REQ-Y-01, Y-03). */
  'partyId',
  /** Phase 6d: REQ-Y-05's dimension — by party, item, item group or month. */
  'groupBy',
  /** 14 REQ-AE-01: the day book narrows to one voucher type, typed as Tally names it. */
  'voucherType',
  /** 14 REQ-AE-02: the ledger extract is for one ledger, named as Tally names it. */
  'ledgerName',
  /** 14: the item analyses narrow to one item by name. */
  'itemName',
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

/**
 * REQ-S-05: one row per voucher type per month. `total` is the sum of
 * `vouchers.amount` — a held figure summed for reconciliation only, shown as
 * exact decimal text; nothing downstream computes on it.
 */
const VOUCHER_RECONCILIATION_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'month', header: 'Month', type: 'text', sortField: 'month', width: 10 },
  { key: 'voucherType', header: 'Voucher type', type: 'text', sortField: 'voucherType', width: 18 },
  { key: 'count', header: 'Vouchers', type: 'number', width: 10 },
  { key: 'cancelled', header: 'Cancelled', type: 'number', secondary: true, width: 10 },
  { key: 'total', header: 'Total value', type: 'text', width: 16 },
  { key: 'lastPulledAt', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/**
 * REQ-Y-05's dimensions. Salesperson is not among them: Tally's voucher does
 * not carry one, and a dimension the projection cannot answer would be a
 * column of blanks presented as a choice.
 */
export const SALES_ANALYSIS_DIMENSIONS = ['party', 'item', 'itemGroup', 'month'] as const;
export type SalesAnalysisDimension = (typeof SALES_ANALYSIS_DIMENSIONS)[number];
export const SALES_ANALYSIS_DIMENSION_LABELS: Record<SalesAnalysisDimension, string> = {
  party: 'By party',
  item: 'By item',
  itemGroup: 'By item group',
  month: 'By month',
};

/**
 * REQ-Y-01: every voucher for one party in the period, with a running
 * balance that starts from what came before the period. Debit and credit
 * follow the voucher type (Sales and Debit Note debit the customer; Receipt
 * and Credit Note credit them); a type outside that table shows its amount
 * unclassified and leaves the balance alone — an honest blank beats a
 * guessed sign.
 */
const CUSTOMER_STATEMENT_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'date', header: 'Date', type: 'date', sortField: 'date', width: 12 },
  { key: 'voucherType', header: 'Type', type: 'text', width: 14 },
  { key: 'voucherNumber', header: 'Number', type: 'code', width: 16 },
  { key: 'narration', header: 'Narration', type: 'text', secondary: true, width: 30 },
  { key: 'debit', header: 'Debit', type: 'text', width: 14 },
  { key: 'credit', header: 'Credit', type: 'text', width: 14 },
  { key: 'unclassified', header: 'Unclassified', type: 'text', secondary: true, width: 14 },
  { key: 'balance', header: 'Balance', type: 'text', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/**
 * REQ-Y-03: credit limit and days against exposure. Exposure is the party's
 * balance from every voucher this projection holds (debits less credits).
 * "Actual overdue" is deliberately absent until bill-wise allocations
 * arrive (P6b): without them, which invoice a receipt settled is a guess.
 */
const CREDIT_CYCLE_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'partyName', header: 'Party', type: 'text', sortField: 'partyName', width: 28 },
  { key: 'creditLimit', header: 'Credit limit', type: 'text', width: 14 },
  { key: 'creditDays', header: 'Credit days', type: 'number', width: 10 },
  { key: 'exposure', header: 'Exposure', type: 'text', sortField: 'exposure', width: 14 },
  { key: 'headroom', header: 'Headroom', type: 'text', width: 14 },
  { key: 'overLimit', header: 'Over limit', type: 'status', width: 10 },
  { key: 'lastInvoiceDate', header: 'Last invoice', type: 'date', secondary: true, width: 12 },
  { key: 'lastReceiptDate', header: 'Last receipt', type: 'date', secondary: true, width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/**
 * REQ-Y-05: sales value by the chosen dimension, from the inventory lines of
 * Sales vouchers that were not cancelled. Value only — margin needs a cost
 * the projection holds only as a "held figure" that Tally may or may not
 * maintain, and a margin computed on a stale cost is a wrong number that
 * looks right.
 */
const SALES_ANALYSIS_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'label', header: 'Group', type: 'text', sortField: 'label', width: 28 },
  { key: 'vouchers', header: 'Invoices', type: 'number', width: 10 },
  { key: 'quantity', header: 'Quantity', type: 'text', secondary: true, width: 12 },
  { key: 'value', header: 'Value', type: 'text', sortField: 'value', width: 16 },
  { key: 'share', header: 'Share', type: 'text', secondary: true, width: 8 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 12 REQ-AA-30: every open order with a balance, by party, by age, by item. */
const PENDING_DISPATCH_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'orderNumber', header: 'Order', type: 'code', sortField: 'orderNumber', width: 12 },
  { key: 'customerName', header: 'Party', type: 'text', sortField: 'customerName', width: 26 },
  { key: 'orderDate', header: 'Order date', type: 'date', sortField: 'orderDate', width: 12 },
  { key: 'ageDays', header: 'Age (days)', type: 'number', sortField: 'ageDays', width: 10 },
  { key: 'item', header: 'Item', type: 'text', width: 26 },
  { key: 'ordered', header: 'Ordered', type: 'text', width: 10 },
  { key: 'packed', header: 'Packed', type: 'text', secondary: true, width: 10 },
  { key: 'invoiced', header: 'Invoiced', type: 'text', secondary: true, width: 10 },
  { key: 'dispatched', header: 'Dispatched', type: 'text', width: 10 },
  { key: 'balance', header: 'Balance', type: 'text', width: 10 },
  { key: 'fulfilment', header: 'Stage', type: 'status', width: 16 },
];

/** 13 REQ-AC-06: at or below reorder level, with committed, available, open PO and the shortfall. */
const LOW_STOCK_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'closing', header: 'Closing (Tally)', type: 'text', width: 12 },
  { key: 'committed', header: 'Committed', type: 'text', width: 12 },
  { key: 'available', header: 'Available', type: 'text', sortField: 'available', width: 12 },
  { key: 'reorderLevel', header: 'Reorder level', type: 'text', width: 12 },
  { key: 'openPo', header: 'On order', type: 'text', width: 12 },
  { key: 'shortfall', header: 'Shortfall', type: 'text', sortField: 'shortfall', width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/**
 * 14 REQ-AE-01: every voucher for a period — the workhorse mirror. Vyuha
 * computes nothing; it lists what Tally already said, filterable by type
 * and party, each row stamped with the sync it is as of (REQ-AD-06).
 */
const DAY_BOOK_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'date', header: 'Date', type: 'date', sortField: 'date', width: 12 },
  { key: 'voucherType', header: 'Type', type: 'text', sortField: 'voucherType', width: 16 },
  { key: 'voucherNumber', header: 'Number', type: 'code', width: 12 },
  { key: 'partyName', header: 'Party', type: 'text', sortField: 'partyName', width: 28 },
  { key: 'amount', header: 'Amount', type: 'text', sortField: 'amount', width: 16 },
  { key: 'narration', header: 'Narration', type: 'text', secondary: true, width: 36 },
  { key: 'cancelled', header: 'State', type: 'status', secondary: true, width: 10 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/**
 * 14 REQ-AG-02: customers who bought regularly and then stopped. The
 * expected gap is each customer's own median gap between sales vouchers
 * (D-36 in `14`): a monthly buyer and an annual buyer lapse at different
 * speeds. Lapsed past twice the median, at risk past once; ranked by the
 * last twelve months' revenue — what the silence is costing.
 */
const CUSTOMER_LAPSE_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'partyName', header: 'Customer', type: 'text', sortField: 'partyName', width: 28 },
  { key: 'state', header: 'State', type: 'status', width: 10 },
  { key: 'lastSaleDate', header: 'Last sale', type: 'date', sortField: 'lastSaleDate', width: 12 },
  { key: 'daysSince', header: 'Days since', type: 'number', sortField: 'daysSince', width: 10 },
  { key: 'medianGapDays', header: 'Usual gap', type: 'number', width: 10 },
  { key: 'expectedBy', header: 'Expected by', type: 'date', secondary: true, width: 12 },
  { key: 'sales12m', header: 'Sales (12m)', type: 'number', secondary: true, width: 10 },
  { key: 'revenue12m', header: 'Revenue (12m)', type: 'text', sortField: 'revenue12m', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AE-02: one ledger's transactions with a running balance, opening from what came before. */
const LEDGER_EXTRACT_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'date', header: 'Date', type: 'date', width: 12 },
  { key: 'voucherType', header: 'Type', type: 'text', width: 14 },
  { key: 'voucherNumber', header: 'Number', type: 'code', width: 12 },
  { key: 'partyName', header: 'Party', type: 'text', secondary: true, width: 24 },
  { key: 'debit', header: 'Debit', type: 'text', width: 14 },
  { key: 'credit', header: 'Credit', type: 'text', width: 14 },
  { key: 'balance', header: 'Balance', type: 'text', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AF-01: closing per item, extended with Vyuha's committed and available (REQ-AC-03, AC-04). */
const STOCK_SUMMARY_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'group', header: 'Group', type: 'text', secondary: true, width: 18 },
  { key: 'unit', header: 'Unit', type: 'text', secondary: true, width: 8 },
  { key: 'closingQty', header: 'Closing', type: 'text', sortField: 'closingQty', width: 12 },
  { key: 'committedQty', header: 'Committed', type: 'text', width: 12 },
  { key: 'availableQty', header: 'Available', type: 'text', width: 12 },
  { key: 'costRate', header: 'Cost rate', type: 'text', secondary: true, width: 12 },
  { key: 'value', header: 'Value at cost', type: 'text', sortField: 'value', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AF-07 / AH-01: billed what was never received. The ideal state is empty. */
const NEGATIVE_STOCK_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 30 },
  { key: 'group', header: 'Group', type: 'text', secondary: true, width: 18 },
  { key: 'closingQty', header: 'Closing', type: 'text', sortField: 'closingQty', width: 12 },
  { key: 'unit', header: 'Unit', type: 'text', width: 8 },
  { key: 'lastPulledAt', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AH-11: a company whose projection has quietly stopped being the truth. */
const STALE_PROJECTIONS_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'companyName', header: 'Company', type: 'text', width: 28 },
  { key: 'connectionState', header: 'Connection', type: 'status', width: 12 },
  { key: 'lastPulledAt', header: 'Last pull', type: 'instant', width: 20 },
  { key: 'hoursStale', header: 'Hours stale', type: 'number', sortField: 'hoursStale', width: 10 },
];

/** 14 REQ-AH-12: near-matching master names. Vyuha flags; the accountant merges in Tally. */
const DUPLICATE_MASTERS_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'kind', header: 'Master', type: 'text', width: 10 },
  { key: 'nameA', header: 'Name', type: 'text', width: 30 },
  { key: 'nameB', header: 'Looks like', type: 'text', width: 30 },
  { key: 'reason', header: 'Why flagged', type: 'text', secondary: true, width: 24 },
];

/** 14 REQ-AG-01/AG-12: who buys what — the matrix as drillable rows, party-first or item-first by sort. */
const CUSTOMER_ITEM_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'partyName', header: 'Customer', type: 'text', sortField: 'partyName', width: 26 },
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 26 },
  { key: 'invoices', header: 'Invoices', type: 'number', width: 10 },
  { key: 'quantity', header: 'Quantity', type: 'text', width: 12 },
  { key: 'value', header: 'Value', type: 'text', sortField: 'value', width: 14 },
  { key: 'lastDate', header: 'Last sale', type: 'date', sortField: 'lastDate', width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-03: how often each customer buys, and whether the rhythm is slowing. */
const PURCHASE_RHYTHM_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'partyName', header: 'Customer', type: 'text', sortField: 'partyName', width: 26 },
  { key: 'sales12m', header: 'Sales (12m)', type: 'number', sortField: 'sales12m', width: 10 },
  { key: 'perMonth', header: 'Per month', type: 'text', width: 10 },
  { key: 'medianGapDays', header: 'Usual gap', type: 'number', width: 10 },
  { key: 'lastGapDays', header: 'Last gap', type: 'number', secondary: true, width: 10 },
  { key: 'daysSince', header: 'Days since', type: 'number', sortField: 'daysSince', width: 10 },
  { key: 'trend', header: 'Trend', type: 'status', width: 10 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-04: the same item at different rates, ranked by the spread. */
const PRICE_VARIANCE_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 26 },
  { key: 'buyers', header: 'Buyers', type: 'number', width: 8 },
  { key: 'minRate', header: 'Lowest', type: 'text', width: 12 },
  { key: 'minParty', header: 'Who pays least', type: 'text', secondary: true, width: 22 },
  { key: 'maxRate', header: 'Highest', type: 'text', width: 12 },
  { key: 'maxParty', header: 'Who pays most', type: 'text', secondary: true, width: 22 },
  { key: 'avgRate', header: 'Average', type: 'text', secondary: true, width: 12 },
  { key: 'spreadPct', header: 'Spread', type: 'text', sortField: 'spreadPct', width: 10 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-13/AG-14: units per month, the trend, and the cover in days that makes it actionable. */
const ITEM_VELOCITY_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'monthly12', header: 'Per month (12m)', type: 'text', sortField: 'monthly12', width: 14 },
  { key: 'monthly3', header: 'Per month (3m)', type: 'text', width: 14 },
  { key: 'trend', header: 'Trend', type: 'status', width: 10 },
  { key: 'closingQty', header: 'Closing', type: 'text', secondary: true, width: 12 },
  { key: 'coverDays', header: 'Cover (days)', type: 'number', sortField: 'coverDays', width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-15: stock that stopped moving, ranked by the money locked up. */
const DEAD_STOCK_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'lastSaleDate', header: 'Last sale', type: 'date', sortField: 'lastSaleDate', width: 12 },
  { key: 'daysIdle', header: 'Days idle', type: 'number', sortField: 'daysIdle', width: 10 },
  { key: 'closingQty', header: 'Closing', type: 'text', width: 12 },
  { key: 'valueLocked', header: 'Value locked', type: 'text', sortField: 'valueLocked', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-16: inward and outward per item per month. */
const MOVEMENT_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'month', header: 'Month', type: 'text', sortField: 'month', width: 10 },
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'inwardQty', header: 'Inward', type: 'text', width: 12 },
  { key: 'outwardQty', header: 'Outward', type: 'text', width: 12 },
  { key: 'netQty', header: 'Net', type: 'text', width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-23: what was bought from whom, with the rate's direction. */
const VENDOR_ITEM_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'vendorName', header: 'Vendor', type: 'text', sortField: 'vendorName', width: 24 },
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 26 },
  { key: 'purchases', header: 'Purchases', type: 'number', width: 10 },
  { key: 'quantity', header: 'Quantity', type: 'text', secondary: true, width: 12 },
  { key: 'lastRate', header: 'Last rate', type: 'text', width: 12 },
  { key: 'avgRate', header: 'Avg rate', type: 'text', secondary: true, width: 12 },
  { key: 'lastDate', header: 'Last bought', type: 'date', sortField: 'lastDate', width: 12 },
  { key: 'rateTrend', header: 'Rate', type: 'status', width: 10 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AG-27: the same item across vendors — the report that pays for itself on the first PO. */
const VENDOR_PRICE_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'vendors', header: 'Vendors', type: 'number', width: 8 },
  { key: 'bestRate', header: 'Best last rate', type: 'text', width: 14 },
  { key: 'bestVendor', header: 'From', type: 'text', width: 22 },
  { key: 'worstRate', header: 'Highest last rate', type: 'text', secondary: true, width: 14 },
  { key: 'worstVendor', header: 'From', type: 'text', secondary: true, width: 22 },
  { key: 'spreadPct', header: 'Spread', type: 'text', sortField: 'spreadPct', width: 10 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AH-04: over the limit now, and how it was released before. */
const CREDIT_BREACHES_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'partyName', header: 'Party', type: 'text', sortField: 'partyName', width: 26 },
  { key: 'creditLimit', header: 'Limit', type: 'text', width: 14 },
  { key: 'exposure', header: 'Exposure', type: 'text', sortField: 'exposure', width: 14 },
  { key: 'overBy', header: 'Over by', type: 'text', sortField: 'overBy', width: 14 },
  { key: 'releases90d', header: 'Releases (90d)', type: 'number', secondary: true, width: 12 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
];

/** 14 REQ-AF-03/AG-37: closing stock bucketed by inward age (FIFO-assumed, D-46), valued at cost. */
const STOCK_AGEING_COLUMNS: readonly ReportColumnSpec[] = [
  { key: 'item', header: 'Item', type: 'text', sortField: 'item', width: 28 },
  { key: 'closingQty', header: 'Closing', type: 'text', width: 12 },
  { key: 'bucket0', header: '0–30d', type: 'text', width: 10 },
  { key: 'bucket31', header: '31–60d', type: 'text', width: 10 },
  { key: 'bucket61', header: '61–90d', type: 'text', width: 10 },
  { key: 'bucket90', header: '90d+', type: 'text', width: 10 },
  { key: 'valueLocked', header: 'Value at cost', type: 'text', sortField: 'valueLocked', width: 16 },
  { key: 'asOf', header: 'As of', type: 'instant', secondary: true, width: 20 },
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
  'voucher-reconciliation': {
    key: 'voucher-reconciliation',
    label: 'Voucher reconciliation',
    description:
      'Voucher count and total value per voucher type per month, from the Tally projection — compare against Tally’s own Day Book totals before signing off a backfill (REQ-S-05).',
    columns: VOUCHER_RECONCILIATION_COLUMNS,
    defaultSort: 'month',
    filters: ['period'],
  },
  'customer-statement': {
    key: 'customer-statement',
    label: 'Customer statement',
    description:
      'Every voucher for one party in the period with a running balance, opening from what came before (REQ-Y-01). Choose a party to begin.',
    columns: CUSTOMER_STATEMENT_COLUMNS,
    defaultSort: 'date',
    filters: ['partyId', 'period'],
    requiredFilters: ['partyId'],
  },
  'credit-cycle': {
    key: 'credit-cycle',
    label: 'Credit cycle',
    description:
      'Credit limit and credit days per party against current exposure (REQ-Y-03). Overdue by bill waits for bill-wise allocations.',
    columns: CREDIT_CYCLE_COLUMNS,
    defaultSort: '-exposure',
    filters: ['partyId'],
  },
  'sales-analysis': {
    key: 'sales-analysis',
    label: 'Sales analysis',
    description: 'Sales value by party, item, item group or month, from invoiced inventory lines (REQ-Y-05).',
    columns: SALES_ANALYSIS_COLUMNS,
    defaultSort: '-value',
    filters: ['groupBy', 'period', 'partyId'],
  },
  'pending-dispatch': {
    key: 'pending-dispatch',
    label: 'Pending dispatch',
    description: 'Every open sales order line with a balance still to dispatch — by party, by age, by item (REQ-AA-30).',
    columns: PENDING_DISPATCH_COLUMNS,
    defaultSort: '-ageDays',
    filters: ['partyId'],
  },
  'low-stock': {
    key: 'low-stock',
    label: 'Low stock',
    description: 'Items at or below their reorder level: Tally closing, committed to open orders, available, on order, and the shortfall (REQ-AC-06).',
    columns: LOW_STOCK_COLUMNS,
    defaultSort: '-shortfall',
    filters: [],
  },
  'day-book': {
    key: 'day-book',
    label: 'Day book',
    description: 'Every voucher for the period, from the Tally projection — filter by type or party; Vyuha computes nothing (14 REQ-AE-01).',
    columns: DAY_BOOK_COLUMNS,
    defaultSort: '-date',
    filters: ['period', 'voucherType', 'partyId'],
  },
  'customer-lapse': {
    key: 'customer-lapse',
    label: 'Customer lapse',
    description: 'Customers who bought regularly and then stopped — measured against each customer’s own usual gap, ranked by the revenue at risk (14 REQ-AG-02).',
    columns: CUSTOMER_LAPSE_COLUMNS,
    defaultSort: '-revenue12m',
    filters: [],
  },
  'ledger-extract': {
    key: 'ledger-extract',
    label: 'Ledger extract',
    description: 'Every line for one ledger with a running balance, opening from what came before (14 REQ-AE-02). Type the ledger as Tally names it.',
    columns: LEDGER_EXTRACT_COLUMNS,
    defaultSort: 'date',
    filters: ['ledgerName', 'period'],
    requiredFilters: ['ledgerName'],
  },
  'stock-summary': {
    key: 'stock-summary',
    label: 'Stock summary',
    description: 'Closing, committed and available per item, valued at the held cost (14 REQ-AF-01; REQ-AC-03, AC-04).',
    columns: STOCK_SUMMARY_COLUMNS,
    defaultSort: '-value',
    filters: ['itemName'],
  },
  'negative-stock': {
    key: 'negative-stock',
    label: 'Negative stock',
    description: 'Items showing a negative closing in Tally — something was billed that was never received (14 REQ-AF-07, AH-01). The ideal state is empty.',
    columns: NEGATIVE_STOCK_COLUMNS,
    defaultSort: 'closingQty',
    filters: [],
  },
  'stale-projections': {
    key: 'stale-projections',
    label: 'Stale projections',
    description: 'Companies whose last successful pull is older than a day — the figures under every other report (14 REQ-AH-11).',
    columns: STALE_PROJECTIONS_COLUMNS,
    defaultSort: '-hoursStale',
    filters: [],
  },
  'duplicate-masters': {
    key: 'duplicate-masters',
    label: 'Duplicate masters',
    description: 'Party and item names that collapse to the same thing once case, spaces and punctuation are ignored. Vyuha flags; the merge happens in Tally (14 REQ-AH-12).',
    columns: DUPLICATE_MASTERS_COLUMNS,
    defaultSort: 'nameA',
    filters: [],
  },
  'customer-item-matrix': {
    key: 'customer-item-matrix',
    label: 'Customer × product',
    description: 'What each customer buys — quantity, value, last sale — one row per customer and item; sort by item to read it the other way (14 REQ-AG-01, AG-12).',
    columns: CUSTOMER_ITEM_COLUMNS,
    defaultSort: '-value',
    filters: ['period', 'partyId', 'itemName'],
  },
  'purchase-rhythm': {
    key: 'purchase-rhythm',
    label: 'Purchase rhythm',
    description: 'Orders per month, the usual gap, the last gap and days since — who to call, before the lapse report has to say so (14 REQ-AG-03).',
    columns: PURCHASE_RHYTHM_COLUMNS,
    defaultSort: '-daysSince',
    filters: [],
  },
  'price-variance': {
    key: 'price-variance',
    label: 'Customer price variance',
    description: 'The same item sold at different rates, ranked by the spread — answers "why is this customer paying more" before the customer asks (14 REQ-AG-04).',
    columns: PRICE_VARIANCE_COLUMNS,
    defaultSort: '-spreadPct',
    filters: ['period', 'itemName'],
  },
  'item-velocity': {
    key: 'item-velocity',
    label: 'Item velocity',
    description: 'Units per month over twelve months against the last three, and the stock cover in days that makes the figure actionable (14 REQ-AG-13, AG-14).',
    columns: ITEM_VELOCITY_COLUMNS,
    defaultSort: '-monthly12',
    filters: ['itemName'],
  },
  'dead-stock': {
    key: 'dead-stock',
    label: 'Dead and slow stock',
    description: 'No sale in ninety days, ranked by the money locked up rather than the quantity (14 REQ-AG-15).',
    columns: DEAD_STOCK_COLUMNS,
    defaultSort: '-valueLocked',
    filters: ['itemName'],
  },
  'movement-analysis': {
    key: 'movement-analysis',
    label: 'Movement analysis',
    description: 'Inward and outward per item per month, from purchase and sales lines (14 REQ-AG-16).',
    columns: MOVEMENT_COLUMNS,
    defaultSort: '-month',
    filters: ['period', 'itemName'],
  },
  'vendor-item-history': {
    key: 'vendor-item-history',
    label: 'Vendor × item history',
    description: 'What was bought from whom — quantity, last and average rate, and which way the rate is moving (14 REQ-AG-23).',
    columns: VENDOR_ITEM_COLUMNS,
    defaultSort: '-lastDate',
    filters: ['period', 'partyId', 'itemName'],
  },
  'vendor-price-comparison': {
    key: 'vendor-price-comparison',
    label: 'Vendor price comparison',
    description: 'The same item across vendors, best and highest last rate with the spread — read it before raising the PO (14 REQ-AG-27).',
    columns: VENDOR_PRICE_COLUMNS,
    defaultSort: '-spreadPct',
    filters: ['itemName'],
  },
  'credit-breaches': {
    key: 'credit-breaches',
    label: 'Credit breaches',
    description: 'Parties over their credit limit now, with how often the block was released in the last ninety days (14 REQ-AH-04).',
    columns: CREDIT_BREACHES_COLUMNS,
    defaultSort: '-overBy',
    filters: [],
  },
  'stock-ageing': {
    key: 'stock-ageing',
    label: 'Stock ageing',
    description: 'Closing stock bucketed by how long it has been held, FIFO-assumed from purchase inwards, valued at cost (14 REQ-AF-03, AG-37).',
    columns: STOCK_AGEING_COLUMNS,
    defaultSort: '-valueLocked',
    filters: ['itemName'],
  },
};

/**
 * The attendance module's reports. Named as a group so another module's
 * definitions can join `ALL_REPORTS` without the attendance source claiming
 * their keys: each module's source claims its own group, and the registry's
 * duplicate refusal stays a safety net instead of becoming a planned boot
 * failure. The Tally group is the first such joiner.
 */
export const ATTENDANCE_REPORTS: readonly ReportDefinition[] = REPORT_KEYS.filter(
  (key) =>
    !(TALLY_REPORT_KEYS as readonly string[]).includes(key) &&
    !(SALES_REPORT_KEYS as readonly string[]).includes(key) &&
    !(ANALYTICS_REPORT_KEYS as readonly string[]).includes(key),
).map((key) => REPORT_DEFINITIONS[key]);

export const SALES_REPORTS: readonly ReportDefinition[] = SALES_REPORT_KEYS.map((key) => REPORT_DEFINITIONS[key]);

/** The Tally module's reports (Phase 6c onward). */
export const TALLY_REPORTS: readonly ReportDefinition[] = TALLY_REPORT_KEYS.map(
  (key) => REPORT_DEFINITIONS[key],
);

export const ANALYTICS_REPORTS: readonly ReportDefinition[] = ANALYTICS_REPORT_KEYS.map(
  (key) => REPORT_DEFINITIONS[key],
);

/** Every module's reports. Grows by concatenation as modules add groups. */
export const ALL_REPORTS: readonly ReportDefinition[] = [...ATTENDANCE_REPORTS, ...TALLY_REPORTS, ...SALES_REPORTS, ...ANALYTICS_REPORTS];

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
  partyId: z.uuid().optional(),
  groupBy: z.enum(SALES_ANALYSIS_DIMENSIONS).optional(),
  voucherType: z.string().trim().min(1).max(60).optional(),
  ledgerName: z.string().trim().min(1).max(120).optional(),
  itemName: z.string().trim().min(1).max(120).optional(),
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
  /**
   * How a calendar date is written (REQ-L-01).
   *
   * Passed in rather than assumed, because the format is an organisation
   * setting and this module has no way to read one. Identity by default, which
   * is what a caller with no opinion gets -- but every caller that puts these
   * captions in front of a person has an opinion, and a header block reading
   * "Period 2026-08-01 to 2026-08-31" directly above "Generated 15-08-2026" is
   * two date formats in four lines of the same file.
   */
  formatDate: (iso: string) => string = (iso) => iso,
): FilterCaption[] {
  const captions: FilterCaption[] = [];
  const named = (id: string): string => names[id] ?? id;

  if (filters.from !== undefined && filters.from === filters.to) {
    // The daily muster's period is one day. "02-03-2026 to 02-03-2026" is true
    // and reads as a mistake, at the top of a file somebody prints.
    captions.push({ label: 'Date', value: formatDate(filters.from) });
  } else if (filters.from !== undefined || filters.to !== undefined) {
    captions.push({
      label: 'Period',
      value: `${filters.from === undefined ? 'any' : formatDate(filters.from)} to ${
        filters.to === undefined ? 'any' : formatDate(filters.to)
      }`,
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

/** One reconciliation row as the source produces it (Phase 6c, REQ-S-05). */
export interface VoucherReconciliationSource {
  readonly month: string;
  readonly voucherType: string;
  readonly count: number;
  readonly cancelled: number;
  /** Exact decimal text — summed once for reconciliation, never computed on again. */
  readonly total: string;
  readonly lastPulledAt: string;
}

export function voucherReconciliationCell(row: VoucherReconciliationSource, key: string): ReportCellValue {
  switch (key) {
    case 'month':
      return row.month;
    case 'voucherType':
      return row.voucherType;
    case 'count':
      return row.count;
    case 'cancelled':
      return row.cancelled;
    case 'total':
      return row.total;
    case 'lastPulledAt':
      return row.lastPulledAt;
    default:
      return null;
  }
}

/** One statement line (Phase 6d, REQ-Y-01). Money as exact decimal text. */
export interface CustomerStatementSource {
  readonly id: string;
  readonly date: string;
  readonly voucherType: string;
  readonly voucherNumber: string;
  readonly narration: string | null;
  readonly debit: string | null;
  readonly credit: string | null;
  readonly unclassified: string | null;
  readonly balance: string;
  readonly asOf: string | null;
}

export function customerStatementCell(row: CustomerStatementSource, key: string): ReportCellValue {
  switch (key) {
    case 'date':
      return row.date;
    case 'voucherType':
      return row.voucherType;
    case 'voucherNumber':
      return row.voucherNumber;
    case 'narration':
      return row.narration;
    case 'debit':
      return row.debit;
    case 'credit':
      return row.credit;
    case 'unclassified':
      return row.unclassified;
    case 'balance':
      return row.balance;
    case 'asOf':
      return row.asOf;
    default:
      return null;
  }
}

/** One party's credit position (Phase 6d, REQ-Y-03). */
export interface CreditCycleSource {
  readonly partyId: string;
  readonly partyName: string;
  readonly creditLimit: string | null;
  readonly creditDays: number | null;
  readonly exposure: string;
  readonly headroom: string | null;
  readonly overLimit: boolean;
  readonly lastInvoiceDate: string | null;
  readonly lastReceiptDate: string | null;
  readonly asOf: string | null;
}

export function creditCycleCell(row: CreditCycleSource, key: string): ReportCellValue {
  switch (key) {
    case 'partyName':
      return row.partyName;
    case 'creditLimit':
      return row.creditLimit;
    case 'creditDays':
      return row.creditDays;
    case 'exposure':
      return row.exposure;
    case 'headroom':
      return row.headroom;
    case 'overLimit':
      return row.overLimit ? 'OVER_LIMIT' : 'WITHIN_LIMIT';
    case 'lastInvoiceDate':
      return row.lastInvoiceDate;
    case 'lastReceiptDate':
      return row.lastReceiptDate;
    case 'asOf':
      return row.asOf;
    default:
      return null;
  }
}

/** One group of sales (Phase 6d, REQ-Y-05). */
export interface SalesAnalysisSource {
  readonly key: string;
  readonly label: string;
  readonly vouchers: number;
  readonly quantity: string | null;
  readonly value: string;
  /** Percentage of the period's total, one decimal, as text. */
  readonly share: string;
  readonly asOf: string | null;
}

export function salesAnalysisCell(row: SalesAnalysisSource, key: string): ReportCellValue {
  switch (key) {
    case 'label':
      return row.label;
    case 'vouchers':
      return row.vouchers;
    case 'quantity':
      return row.quantity;
    case 'value':
      return row.value;
    case 'share':
      return row.share;
    case 'asOf':
      return row.asOf;
    default:
      return null;
  }
}

export interface PendingDispatchSource {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly orderDate: string;
  readonly ageDays: number;
  readonly item: string;
  readonly ordered: string;
  readonly packed: string;
  readonly invoiced: string;
  readonly dispatched: string;
  readonly balance: string;
  readonly fulfilment: string;
}

export function pendingDispatchCell(row: PendingDispatchSource, key: string): ReportCellValue {
  switch (key) {
    case 'orderNumber': return row.orderNumber;
    case 'customerName': return row.customerName;
    case 'orderDate': return row.orderDate;
    case 'ageDays': return row.ageDays;
    case 'item': return row.item;
    case 'ordered': return row.ordered;
    case 'packed': return row.packed;
    case 'invoiced': return row.invoiced;
    case 'dispatched': return row.dispatched;
    case 'balance': return row.balance;
    case 'fulfilment': return row.fulfilment.toUpperCase();
    default: return null;
  }
}

export interface LowStockSource {
  readonly stockItemId: string;
  readonly item: string;
  readonly closing: string | null;
  readonly committed: string;
  readonly available: string | null;
  readonly reorderLevel: string;
  readonly openPo: string;
  readonly shortfall: string;
  readonly asOf: string | null;
}

export function lowStockCell(row: LowStockSource, key: string): ReportCellValue {
  switch (key) {
    case 'item': return row.item;
    case 'closing': return row.closing;
    case 'committed': return row.committed;
    case 'available': return row.available;
    case 'reorderLevel': return row.reorderLevel;
    case 'openPo': return row.openPo;
    case 'shortfall': return row.shortfall;
    case 'asOf': return row.asOf;
    default: return null;
  }
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

// ---------------------------------------------------------- scheduled exports

/**
 * REQ-J-05, delivered to the Downloads tray rather than to an inbox.
 *
 * The requirement as written says "emailed daily/weekly/monthly to a list of
 * recipients". This product has no mail transport -- it was removed, because
 * the pilot has no mail server and REQ-B-03's invitation link is handed over by
 * the administrator instead. A schedule therefore produces exactly what the
 * Export button produces, on a timer, into the same tray with the same seven
 * day retention and the same signed download. Nothing about the file differs;
 * only what started it.
 *
 * That substitution is deliberate and is the whole of the deviation. A schedule
 * that emailed would need a transport, a recipient list, a bounce path and a
 * decision about sending employee data to an address nobody in the product has
 * verified. Landing it in the tray needs none of those, and the person who
 * wanted the report still finds it waiting for them.
 */
export const SCHEDULE_CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

export const SCHEDULE_CADENCE_LABELS: Record<ScheduleCadence, string> = {
  DAILY: 'Every day',
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
};

/**
 * The latest day of the month a schedule may name.
 *
 * 28 rather than 31, because a monthly schedule set to the 30th would not run
 * in February at all and a schedule set to the 31st would skip five months a
 * year -- silently, which is the worst way for a report to be missing. Anyone
 * wanting the last day of the month wants the month that just ended, and that
 * is what the 1st already gives them.
 */
export const MAX_SCHEDULE_DAY_OF_MONTH = 28;

export const SCHEDULE_NAME_MAX = 80;

/** ISO-8601 weekdays, so 1 is Monday and 7 is Sunday. */
export const SCHEDULE_WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const reportScheduleInputSchema = z
  .object({
    reportKey: z.enum(REPORT_KEYS),
    name: z.string().trim().min(1).max(SCHEDULE_NAME_MAX),
    /**
     * No `from` or `to`. The period a run covers is derived from the cadence --
     * see `scheduleWindow` -- because a stored range would export the same
     * fortnight of August for ever, and would look like it was working.
     */
    filters: reportFilterSchema.omit({ from: true, to: true }).default({}),
    columns: z.array(z.string().max(64)).max(64).default([]),
    sort: z.string().max(200).optional(),
    format: z.enum(AVAILABLE_EXPORT_FORMATS).default('XLSX'),
    cadence: z.enum(SCHEDULE_CADENCES),
    /** On the organisation's wall clock (NFR-05), never the server's. */
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
    /** Weekly only. ISO weekday, 1 = Monday. */
    weekday: z.number().int().min(1).max(7).optional(),
    /** Monthly only. */
    dayOfMonth: z.number().int().min(1).max(MAX_SCHEDULE_DAY_OF_MONTH).optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    // Checked here rather than left to the runner, so a schedule that could
    // never fire is refused at the point somebody can still fix it.
    if (value.cadence === 'WEEKLY' && value.weekday === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: 'A weekly schedule needs the day of the week it runs on.',
      });
    }
    if (value.cadence === 'MONTHLY' && value.dayOfMonth === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayOfMonth'],
        message: 'A monthly schedule needs the day of the month it runs on.',
      });
    }
  });

export type ReportScheduleInput = z.infer<typeof reportScheduleInputSchema>;

export interface ReportSchedule {
  readonly id: string;
  readonly reportKey: ReportKey;
  readonly name: string;
  readonly filters: ReportFilters;
  readonly columns: readonly string[];
  readonly sort: string | null;
  readonly format: ExportFormat;
  readonly cadence: ScheduleCadence;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number | null;
  readonly dayOfMonth: number | null;
  readonly isActive: boolean;
  readonly owner: NamedRef;
  /** The organisation-local date it last produced a file for. */
  readonly lastRunOn: string | null;
  readonly lastExportJobId: string | null;
  /** Null when the last run failed, so the list can say so without a join. */
  readonly lastRunStatus: ExportStatus | null;
  readonly createdAt: string;
}

/**
 * When a schedule next fires, said in words, for the list and the form.
 *
 * Built from the same fields the runner reads, so the sentence on screen cannot
 * describe a different schedule from the one that will run.
 */
export function describeSchedule(schedule: {
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
}): string {
  const clock = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
  switch (schedule.cadence) {
    case 'DAILY':
      return `Every day at ${clock}`;
    case 'WEEKLY':
      return `Every ${SCHEDULE_WEEKDAY_LABELS[schedule.weekday ?? 1] ?? 'Monday'} at ${clock}`;
    case 'MONTHLY': {
      const day = schedule.dayOfMonth ?? 1;
      return `On day ${String(day)} of each month at ${clock}`;
    }
    default:
      return `At ${clock}`;
  }
}

/**
 * The period one run covers, derived from the cadence and never stored.
 *
 * Every window ends *yesterday*. A schedule that ran at 06:00 and included
 * today would export a few hours of punches and call it a day's report, which
 * is worse than not running: the number looks real. Ending on the last complete
 * day means a daily report is yesterday, a weekly one is the seven days up to
 * yesterday, and a monthly one is the calendar month that has finished.
 *
 * `today` is the organisation-local date the run happens on, as `YYYY-MM-DD`.
 */
export function scheduleWindow(
  cadence: ScheduleCadence,
  today: string,
): { from: string; to: string } {
  const [year = 0, month = 1, day = 1] = today.split('-').map(Number);
  // UTC arithmetic on a date-only value, which has no timezone of its own. The
  // caller has already resolved "what day is it there".
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const iso = (date: Date): string => date.toISOString().slice(0, 10);

  const yesterday = new Date(cursor);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  switch (cadence) {
    case 'DAILY':
      return { from: iso(yesterday), to: iso(yesterday) };
    case 'WEEKLY': {
      const start = new Date(yesterday);
      start.setUTCDate(start.getUTCDate() - 6);
      return { from: iso(start), to: iso(yesterday) };
    }
    case 'MONTHLY': {
      // The month that contains yesterday, which on the 1st is the month that
      // has just ended -- the case a monthly schedule exists for.
      const start = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1));
      const end = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, 0));
      return { from: iso(start), to: iso(end) };
    }
    default:
      return { from: iso(yesterday), to: iso(yesterday) };
  }
}

/**
 * Whether a schedule is due on this organisation-local date and time.
 *
 * `lastRunOn` is the idempotency key and it is a date, not an instant: the
 * sweep runs every fifteen minutes, so without it a schedule set for 06:00
 * would fire again at 06:15, 06:30 and every sweep after it until midnight.
 */
export function isScheduleDue(
  schedule: {
    cadence: ScheduleCadence;
    hour: number;
    minute: number;
    weekday?: number | null;
    dayOfMonth?: number | null;
    isActive: boolean;
    lastRunOn?: string | null;
  },
  local: { date: string; hour: number; minute: number; weekday: number; dayOfMonth: number },
): boolean {
  if (!schedule.isActive) return false;
  if (schedule.lastRunOn === local.date) return false;

  if (schedule.cadence === 'WEEKLY' && schedule.weekday !== local.weekday) return false;
  if (schedule.cadence === 'MONTHLY' && schedule.dayOfMonth !== local.dayOfMonth) return false;

  // At or after the appointed minute. A sweep that missed the exact slot --
  // the server was down, the sweep was slow -- still runs, late, rather than
  // skipping the day silently.
  const due = schedule.hour * 60 + schedule.minute;
  return local.hour * 60 + local.minute >= due;
}

/** 14 REQ-AE-01: one voucher, as Tally said it. */
export interface DayBookSource {
  readonly voucherId: string;
  readonly date: string;
  readonly voucherType: string;
  readonly voucherNumber: string;
  readonly partyName: string | null;
  readonly amount: string;
  readonly narration: string | null;
  readonly cancelled: boolean;
  readonly asOf: string | null;
}

export function dayBookCell(row: DayBookSource, key: string): ReportCellValue {
  switch (key) {
    case 'date':
      return row.date;
    case 'voucherType':
      return row.voucherType;
    case 'voucherNumber':
      return row.voucherNumber;
    case 'partyName':
      return row.partyName;
    case 'amount':
      return row.amount;
    case 'narration':
      return row.narration;
    case 'cancelled':
      return row.cancelled ? 'CANCELLED' : 'POSTED';
    case 'asOf':
      return row.asOf;
    default:
      return null;
  }
}

/** 14 REQ-AG-02: one customer measured against their own buying rhythm. */
export interface CustomerLapseSource {
  readonly partyId: string;
  readonly partyName: string;
  /** 'LAPSED' past twice the median gap, 'AT_RISK' past once, else 'ON_RHYTHM'. */
  readonly state: 'LAPSED' | 'AT_RISK' | 'ON_RHYTHM';
  readonly lastSaleDate: string;
  readonly daysSince: number;
  readonly medianGapDays: number;
  readonly expectedBy: string;
  readonly sales12m: number;
  readonly revenue12m: string;
  readonly asOf: string | null;
}

export function customerLapseCell(row: CustomerLapseSource, key: string): ReportCellValue {
  switch (key) {
    case 'partyName':
      return row.partyName;
    case 'state':
      return row.state;
    case 'lastSaleDate':
      return row.lastSaleDate;
    case 'daysSince':
      return row.daysSince;
    case 'medianGapDays':
      return row.medianGapDays;
    case 'expectedBy':
      return row.expectedBy;
    case 'sales12m':
      return row.sales12m;
    case 'revenue12m':
      return row.revenue12m;
    case 'asOf':
      return row.asOf;
    default:
      return null;
  }
}

/**
 * The Tier 1 analytics rows (D-46) are flat records whose keys are their
 * column keys, so one cell reader serves all fifteen shapes — a bespoke
 * switch per report would restate each interface a second time.
 */
export function recordCell(row: Record<string, unknown>, key: string): ReportCellValue {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value as ReportCellValue;
  return String(value);
}

export interface LedgerExtractSource extends Record<string, unknown> {
  readonly id: string;
  readonly date: string;
  readonly voucherType: string;
  readonly voucherNumber: string;
  readonly partyName: string | null;
  readonly debit: string | null;
  readonly credit: string | null;
  readonly balance: string;
  readonly asOf: string | null;
}

export interface StockSummarySource extends Record<string, unknown> {
  readonly stockItemId: string;
  readonly item: string;
  readonly group: string | null;
  readonly unit: string | null;
  readonly closingQty: string | null;
  readonly committedQty: string;
  readonly availableQty: string | null;
  readonly costRate: string | null;
  readonly value: string | null;
  readonly asOf: string | null;
}

export interface NegativeStockSource extends Record<string, unknown> {
  readonly stockItemId: string;
  readonly item: string;
  readonly group: string | null;
  readonly closingQty: string;
  readonly unit: string | null;
  readonly lastPulledAt: string | null;
}

export interface StaleProjectionSource extends Record<string, unknown> {
  readonly connectionId: string;
  readonly companyName: string;
  readonly connectionState: string;
  readonly lastPulledAt: string | null;
  readonly hoursStale: number | null;
}

export interface DuplicateMasterSource extends Record<string, unknown> {
  readonly id: string;
  readonly kind: 'Party' | 'Item';
  readonly nameA: string;
  readonly nameB: string;
  readonly reason: string;
}

export interface CustomerItemSource extends Record<string, unknown> {
  readonly id: string;
  readonly partyId: string | null;
  readonly partyName: string;
  readonly stockItemId: string | null;
  readonly item: string;
  readonly invoices: number;
  readonly quantity: string | null;
  readonly value: string;
  readonly lastDate: string;
  readonly asOf: string | null;
}

export interface PurchaseRhythmSource extends Record<string, unknown> {
  readonly partyId: string;
  readonly partyName: string;
  readonly sales12m: number;
  readonly perMonth: string;
  readonly medianGapDays: number;
  readonly lastGapDays: number | null;
  readonly daysSince: number;
  readonly trend: 'SLOWING' | 'STEADY' | 'QUICKENING';
  readonly asOf: string | null;
}

export interface PriceVarianceSource extends Record<string, unknown> {
  readonly id: string;
  readonly item: string;
  readonly buyers: number;
  readonly minRate: string;
  readonly minParty: string | null;
  readonly maxRate: string;
  readonly maxParty: string | null;
  readonly avgRate: string;
  readonly spreadPct: string;
  readonly asOf: string | null;
}

export interface ItemVelocitySource extends Record<string, unknown> {
  readonly stockItemId: string | null;
  readonly item: string;
  readonly monthly12: string;
  readonly monthly3: string;
  readonly trend: 'RISING' | 'STEADY' | 'FALLING';
  readonly closingQty: string | null;
  readonly coverDays: number | null;
  readonly asOf: string | null;
}

export interface DeadStockSource extends Record<string, unknown> {
  readonly stockItemId: string;
  readonly item: string;
  readonly lastSaleDate: string | null;
  readonly daysIdle: number | null;
  readonly closingQty: string | null;
  readonly valueLocked: string | null;
  readonly asOf: string | null;
}

export interface MovementSource extends Record<string, unknown> {
  readonly id: string;
  readonly month: string;
  readonly item: string;
  readonly inwardQty: string;
  readonly outwardQty: string;
  readonly netQty: string;
  readonly asOf: string | null;
}

export interface VendorItemSource extends Record<string, unknown> {
  readonly id: string;
  readonly vendorName: string;
  readonly partyId: string | null;
  readonly item: string;
  readonly purchases: number;
  readonly quantity: string | null;
  readonly lastRate: string;
  readonly avgRate: string;
  readonly lastDate: string;
  readonly rateTrend: 'RISING' | 'STEADY' | 'FALLING';
  readonly asOf: string | null;
}

export interface VendorPriceSource extends Record<string, unknown> {
  readonly id: string;
  readonly item: string;
  readonly vendors: number;
  readonly bestRate: string;
  readonly bestVendor: string | null;
  readonly worstRate: string;
  readonly worstVendor: string | null;
  readonly spreadPct: string;
  readonly asOf: string | null;
}

export interface CreditBreachSource extends Record<string, unknown> {
  readonly partyId: string;
  readonly partyName: string;
  readonly creditLimit: string | null;
  readonly exposure: string;
  readonly overBy: string;
  readonly releases90d: number;
  readonly asOf: string | null;
}

export interface StockAgeingSource extends Record<string, unknown> {
  readonly stockItemId: string;
  readonly item: string;
  readonly closingQty: string;
  readonly bucket0: string;
  readonly bucket31: string;
  readonly bucket61: string;
  readonly bucket90: string;
  readonly valueLocked: string | null;
  readonly asOf: string | null;
}
