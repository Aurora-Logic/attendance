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
 * Two reports are defined. They are the two whose data exists: attendance days
 * and punches. REQ-J-01's table also lists leave, overtime and headcount
 * reports, and REQ-J-04's payroll handoff; those are deliberately absent
 * rather than stubbed, because a report that renders fabricated rows is worse
 * than a report that is not there yet. Adding one is a `REPORT_DEFINITIONS`
 * entry plus a row source -- no change to the shell, the exporter, or the
 * download tray.
 */

// ------------------------------------------------------------------- reports

export const REPORT_KEYS = ['attendance-register', 'punch-audit'] as const;

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

export const REPORT_DEFINITIONS: Record<ReportKey, ReportDefinition> = {
  'attendance-register': {
    key: 'attendance-register',
    label: 'Attendance register',
    description: 'One row per employee per day: shift, in, out, hours, status and flags.',
    columns: ATTENDANCE_REGISTER_COLUMNS,
    defaultSort: '-date,employeeCode',
    filters: ['period', 'employeeId', 'departmentId', 'locationId', 'status', 'flags'],
  },
  'punch-audit': {
    key: 'punch-audit',
    label: 'Punch audit',
    description: 'The raw punch log with photo, location, device and flags.',
    columns: PUNCH_AUDIT_COLUMNS,
    defaultSort: '-serverTime',
    filters: ['period', 'employeeId', 'departmentId', 'locationId', 'punchType'],
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

  if (filters.from !== undefined || filters.to !== undefined) {
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

/** What the API will actually produce today. The rest are declared, not offered. */
export const AVAILABLE_EXPORT_FORMATS = ['CSV'] as const satisfies readonly ExportFormat[];

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
