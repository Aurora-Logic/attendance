import { z } from 'zod';

import {
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  REPORT_COLUMN_TYPES,
  REPORT_DEFINITIONS,
  REPORT_FILTER_NAMES,
  REPORT_KEYS,
  SCHEDULE_CADENCES,
  absenteeismCell,
  attendanceExceptionCell,
  attendanceRegisterCell,
  headcountCell,
  leaveAvailedCell,
  leaveBalanceCell,
  leaveLedgerCell,
  missingPunchCell,
  musterGridCell,
  punchAuditCell,
  reportFilterSchema,
  savedViewConfigSchema,
  type AttendanceDaySummary,
  type ExportJobSummary,
  type PunchRecord,
  type ReportCellValue,
  type ReportDefinition,
  type ReportKey,
  type ReportSchedule,
  type SavedView,
} from '@vyuha/shared';

/**
 * What the report endpoints actually send, parsed rather than asserted.
 *
 * The screen is generic over a report definition it received from the server,
 * which makes a shape mismatch particularly unpleasant: a missing `columns`
 * array would not throw, it would render a table with no columns and look like
 * a report with no data. Parsing turns that into the error state.
 */

const namedRefSchema = z.object({ id: z.string(), name: z.string() });

export const reportColumnSchema = z.object({
  key: z.string(),
  header: z.string(),
  type: z.enum(REPORT_COLUMN_TYPES),
  secondary: z.boolean().optional(),
  defaultHidden: z.boolean().optional(),
  sortField: z.string().optional(),
  width: z.number().optional(),
});

export const reportDefinitionSchema = z.object({
  key: z.enum(REPORT_KEYS),
  label: z.string(),
  description: z.string(),
  columns: z.array(reportColumnSchema).min(1),
  defaultSort: z.string(),
  filters: z.array(z.enum(REPORT_FILTER_NAMES)),
}) satisfies z.ZodType<ReportDefinition>;

export const reportCatalogueSchema = z.object({
  data: z.array(reportDefinitionSchema).min(1),
});

const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/**
 * The attendance register row is the muster row (`AttendanceDaySummary`), and
 * the punch audit row is the punch feed row (`PunchRecord`). Deliberately the
 * same contracts the other screens read: a report is a different arrangement
 * of the same data, not a different truth about it.
 */
export const attendanceRegisterRowSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  employeeCode: z.string(),
  date: z.string(),
  status: z.string(),
  shift: namedRefSchema.nullable(),
  scheduledIn: z.string().nullable(),
  scheduledOut: z.string().nullable(),
  firstInAt: z.string().nullable(),
  lastOutAt: z.string().nullable(),
  workedMinutes: z.number(),
  breakMinutes: z.number(),
  // Optional to stay identical to `AttendanceDaySummary`, which the assertion
  // at the foot of this file enforces. The server withholds `otMinutes` from a
  // viewer who may see only their own attendance; a report needs `report.view`,
  // which no such account holds, so the register is expected to carry it -- but
  // "expected to" is not a shape a parser may require.
  otMinutes: z.number().optional(),
  lateMinutes: z.number(),
  earlyExitMinutes: z.number(),
  flags: z.array(z.string()).readonly(),
  isManualOverride: z.boolean(),
  locked: z.boolean(),
});

export type AttendanceRegisterRow = z.infer<typeof attendanceRegisterRowSchema>;

export const punchAuditRowSchema = z.object({
  id: z.string(),
  employee: namedRefSchema,
  employeeCode: z.string(),
  attendanceDate: z.string(),
  type: z.string(),
  serverTime: z.string(),
  clientTime: z.string().nullable(),
  clockSkewSeconds: z.number().nullable(),
  syncDelaySeconds: z.number().nullable(),
  source: z.string(),
  photo: z.object({ fileId: z.string(), thumbnailFileId: z.string() }),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyM: z.number().nullable(),
      distanceFromGeofenceM: z.number().nullable(),
    })
    .nullable(),
  isHalfDayMarked: z.boolean(),
  halfDayPart: z.string().nullable(),
  reason: z.string().nullable(),
  flags: z.array(z.string()).readonly(),
});

export type PunchAuditRow = z.infer<typeof punchAuditRowSchema>;

export const attendanceRegisterPageSchema = z.object({
  data: z.array(attendanceRegisterRowSchema),
  meta: pageMetaSchema,
});

export const punchAuditPageSchema = z.object({
  data: z.array(punchAuditRowSchema),
  meta: pageMetaSchema,
});

export const savedViewSchema = z.object({
  id: z.string(),
  reportKey: z.string(),
  name: z.string(),
  config: savedViewConfigSchema,
  isShared: z.boolean(),
  isOwn: z.boolean(),
  createdAt: z.string(),
}) satisfies z.ZodType<SavedView>;

export const savedViewListSchema = z.array(savedViewSchema);

export const exportJobSchema = z.object({
  id: z.string(),
  reportKey: z.string(),
  reportLabel: z.string(),
  status: z.enum(EXPORT_STATUSES),
  format: z.enum(EXPORT_FORMATS),
  filename: z.string(),
  progress: z.number(),
  rowCount: z.number().nullable(),
  error: z.string().nullable(),
  filters: reportFilterSchema,
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  downloadable: z.boolean(),
}) satisfies z.ZodType<ExportJobSummary>;

export const exportJobListSchema = z.object({ data: z.array(exportJobSchema) });

/**
 * REQ-J-05, one scheduled export as the list reads it.
 *
 * Pinned to the shared `ReportSchedule` with `satisfies`, for the reason the
 * attendance day wire row gives: a field the server stops sending is then a
 * compile error here rather than an `undefined` that renders as a blank cell.
 */
export const reportScheduleSchema = z.object({
  id: z.string(),
  reportKey: z.enum(REPORT_KEYS),
  name: z.string(),
  filters: reportFilterSchema,
  columns: z.array(z.string()),
  sort: z.string().nullable(),
  format: z.enum(EXPORT_FORMATS),
  cadence: z.enum(SCHEDULE_CADENCES),
  hour: z.number(),
  minute: z.number(),
  weekday: z.number().nullable(),
  dayOfMonth: z.number().nullable(),
  isActive: z.boolean(),
  owner: z.object({ id: z.string(), name: z.string() }),
  lastRunOn: z.string().nullable(),
  lastExportJobId: z.string().nullable(),
  lastRunStatus: z.enum(EXPORT_STATUSES).nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<ReportSchedule>;

export const reportScheduleListSchema = z.array(reportScheduleSchema);

export const exportDownloadSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number(),
  filename: z.string(),
});

export const signedPhotoSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number(),
});

// ------------------------------------------------- the reports that aggregate

/**
 * The rows the derived reports send.
 *
 * Parsed, not asserted, for the reason the two above are: the shell renders
 * whatever columns the definition names, so a field that arrived as `undefined`
 * would draw an empty cell rather than raise anything. `.catchall` is
 * deliberately absent -- an unexpected key is harmless, a missing one is not.
 */
const employeeRefSchema = z.object({ name: z.string() });

export const musterGridRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  days: z.record(z.string(), z.string().nullable()),
  presentDays: z.number(),
  absentDays: z.number(),
  leaveDays: z.number(),
  halfDays: z.number(),
  onDutyDays: z.number(),
  weeklyOffDays: z.number(),
  holidayDays: z.number(),
  workedMinutes: z.number(),
  otMinutes: z.number(),
  lateDays: z.number(),
});

export const attendanceExceptionRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  locationName: z.string().nullable(),
  occurrences: z.number(),
  totalMinutes: z.number(),
  averageMinutes: z.number(),
  worstMinutes: z.number(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
});

export const absenteeismRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  locationName: z.string().nullable(),
  month: z.string(),
  scheduledDays: z.number(),
  presentDays: z.number(),
  leaveDays: z.number(),
  absentDays: z.number(),
  absencePercent: z.number(),
});

export const missingPunchRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  date: z.string(),
  status: z.string(),
  shiftName: z.string().nullable(),
  punchedInAt: z.string().nullable(),
  punchedOutAt: z.string().nullable(),
  flags: z.array(z.string()).readonly(),
  regularizationStatus: z.string().nullable(),
  regularizationKind: z.string().nullable(),
  regularizationDecidedAt: z.string().nullable(),
  regularizationReason: z.string().nullable(),
});

export const leaveBalanceRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  leaveYear: z.number(),
  opening: z.number(),
  accrued: z.number(),
  availed: z.number(),
  adjusted: z.number(),
  carriedForward: z.number(),
  closing: z.number(),
});

export const leaveLedgerRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  leaveYear: z.number(),
  postedAt: z.string(),
  movementType: z.string(),
  days: z.number(),
  referenceType: z.string().nullable(),
  periodKey: z.string().nullable(),
  note: z.string().nullable(),
});

export const leaveAvailedRowSchema = z.object({
  id: z.string(),
  employee: employeeRefSchema,
  employeeCode: z.string(),
  departmentName: z.string().nullable(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  isPaid: z.boolean(),
  requests: z.number(),
  days: z.number(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
});

export const headcountRowSchema = z.object({
  id: z.string(),
  month: z.string(),
  opening: z.number(),
  joiners: z.number(),
  leavers: z.number(),
  closing: z.number(),
});

// --------------------------------------------------------------- the row view

/**
 * A row as the shell renders it: a key, the two things a phone-sized card
 * shows, and every cell the report's definition names.
 *
 * The cells are extracted once, here, by the same functions in `@vyuha/shared`
 * that the exporter calls -- which is the whole point of the arrangement. The
 * table below this never sees a report-specific row type, so adding a report
 * cannot mean adding a branch to the rendering code, and the screen cannot
 * start reading a field the file does not.
 */
export interface ReportRowView {
  readonly id: string;
  /** Mobile line one (PRD §6.5). */
  readonly primary: string;
  /** Mobile line one, right side. Null for a report with nothing pill-shaped. */
  readonly status: string | null;
  readonly cells: Readonly<Record<string, ReportCellValue>>;
  /** Set only on the punch audit, for REQ-J-02's photo viewer. */
  readonly punch: PunchAuditRow | null;
}

export type MusterGridRow = z.infer<typeof musterGridRowSchema>;
export type AttendanceExceptionRow = z.infer<typeof attendanceExceptionRowSchema>;
export type AbsenteeismRow = z.infer<typeof absenteeismRowSchema>;
export type MissingPunchRow = z.infer<typeof missingPunchRowSchema>;
export type LeaveBalanceRow = z.infer<typeof leaveBalanceRowSchema>;
export type LeaveLedgerRow = z.infer<typeof leaveLedgerRowSchema>;
export type LeaveAvailedRow = z.infer<typeof leaveAvailedRowSchema>;
export type HeadcountRow = z.infer<typeof headcountRowSchema>;

/**
 * How one report's rows become views: the parser, the shared extractor, and the
 * two fields a phone-sized card shows.
 *
 * Generic in the row type and never widened to `unknown`, so `cell` is the
 * extractor that matches `schema` and the compiler says so. `toRowViews`
 * switches on the report key and hands one of these to `build` -- which is why
 * there is not a cast anywhere in this file.
 */
interface RowViewShape<T> {
  readonly schema: z.ZodType<T>;
  readonly cell: (row: T, key: string) => ReportCellValue;
  readonly id: (row: T) => string;
  readonly primary: (row: T) => string;
  readonly status: (row: T) => string | null;
  readonly punch?: (row: T) => PunchAuditRow;
}

const REGISTER_SHAPE: RowViewShape<AttendanceRegisterRow> = {
  schema: attendanceRegisterRowSchema,
  cell: attendanceRegisterCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.status,
};

const PUNCH_SHAPE: RowViewShape<PunchAuditRow> = {
  schema: punchAuditRowSchema,
  cell: punchAuditCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.type,
  punch: (row) => row,
};

const MUSTER_GRID_SHAPE: RowViewShape<MusterGridRow> = {
  schema: musterGridRowSchema,
  cell: musterGridCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: () => null,
};

/** One shape for the three reports that are one query with the measure swapped. */
const EXCEPTION_SHAPE: RowViewShape<AttendanceExceptionRow> = {
  schema: attendanceExceptionRowSchema,
  cell: attendanceExceptionCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: () => null,
};

const ABSENTEEISM_SHAPE: RowViewShape<AbsenteeismRow> = {
  schema: absenteeismRowSchema,
  cell: absenteeismCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.month,
};

const MISSING_PUNCH_SHAPE: RowViewShape<MissingPunchRow> = {
  schema: missingPunchRowSchema,
  cell: missingPunchCell,
  id: (row) => row.id,
  // The correction's state where there is one, because that is what a reader
  // working this list is deciding on; the day's own status otherwise.
  status: (row) => row.regularizationStatus ?? row.status,
  primary: (row) => row.employee.name,
};

const LEAVE_BALANCE_SHAPE: RowViewShape<LeaveBalanceRow> = {
  schema: leaveBalanceRowSchema,
  cell: leaveBalanceCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.leaveTypeCode,
};

const LEAVE_LEDGER_SHAPE: RowViewShape<LeaveLedgerRow> = {
  schema: leaveLedgerRowSchema,
  cell: leaveLedgerCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.movementType,
};

const LEAVE_AVAILED_SHAPE: RowViewShape<LeaveAvailedRow> = {
  schema: leaveAvailedRowSchema,
  cell: leaveAvailedCell,
  id: (row) => row.id,
  primary: (row) => row.employee.name,
  status: (row) => row.leaveTypeCode,
};

const HEADCOUNT_SHAPE: RowViewShape<HeadcountRow> = {
  schema: headcountRowSchema,
  cell: headcountCell,
  id: (row) => row.id,
  primary: (row) => row.month,
  status: () => null,
};

function build<T>(
  shape: RowViewShape<T>,
  reportKey: ReportKey,
  rows: readonly unknown[],
): ReportRowView[] {
  const columns = REPORT_DEFINITIONS[reportKey].columns;
  return rows.map((raw) => {
    const row = shape.schema.parse(raw);
    // Every declared column, not only the visible ones, so turning one on in
    // the F12 chooser redraws from what is already in hand rather than asking
    // the server again for a value it already sent.
    const cells: Record<string, ReportCellValue> = {};
    for (const column of columns) cells[column.key] = shape.cell(row, column.key);
    return {
      id: shape.id(row),
      primary: shape.primary(row),
      status: shape.status(row),
      cells,
      punch: shape.punch === undefined ? null : shape.punch(row),
    };
  });
}

/**
 * One page of any report, as rows the table can render.
 *
 * Throws on a shape it cannot read; `api.ts` turns that into the screen's error
 * state. The switch is exhaustive over `ReportKey` -- adding a report key
 * without a shape here is a compile error, not an empty table.
 */
export function toRowViews(reportKey: ReportKey, rows: readonly unknown[]): ReportRowView[] {
  switch (reportKey) {
    case 'attendance-register':
    case 'daily-muster':
      return build(REGISTER_SHAPE, reportKey, rows);
    case 'punch-audit':
      return build(PUNCH_SHAPE, reportKey, rows);
    case 'monthly-muster':
      return build(MUSTER_GRID_SHAPE, reportKey, rows);
    case 'late-arrivals':
    case 'early-exits':
    case 'overtime':
      return build(EXCEPTION_SHAPE, reportKey, rows);
    case 'absenteeism':
      return build(ABSENTEEISM_SHAPE, reportKey, rows);
    case 'missing-punch':
      return build(MISSING_PUNCH_SHAPE, reportKey, rows);
    case 'leave-balance':
      return build(LEAVE_BALANCE_SHAPE, reportKey, rows);
    case 'leave-ledger':
      return build(LEAVE_LEDGER_SHAPE, reportKey, rows);
    case 'leave-availed':
      return build(LEAVE_AVAILED_SHAPE, reportKey, rows);
    case 'headcount':
      return build(HEADCOUNT_SHAPE, reportKey, rows);
  }
}

/** The envelope every report's rows arrive in. The rows themselves are `unknown`
 *  until `toRowViews` parses them against the report's own shape. */
export const reportPageEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  meta: pageMetaSchema,
});

/**
 * The two row contracts are structurally the shared ones. Stated as a type
 * check rather than a comment so a field renamed in `@vyuha/shared` breaks the
 * build here instead of silently parsing to `undefined` at runtime.
 */
type Assert<T extends true> = T;

export type ContractChecks = [
  Assert<AttendanceDaySummary extends AttendanceRegisterRow ? true : false>,
  Assert<PunchRecord extends PunchAuditRow ? true : false>,
];
