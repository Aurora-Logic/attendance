import { z } from 'zod';

import {
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  REPORT_COLUMN_TYPES,
  REPORT_FILTER_NAMES,
  REPORT_KEYS,
  reportFilterSchema,
  savedViewConfigSchema,
  type AttendanceDaySummary,
  type ExportJobSummary,
  type PunchRecord,
  type ReportDefinition,
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
  otMinutes: z.number(),
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

export const exportDownloadSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number(),
  filename: z.string(),
});

export const signedPhotoSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number(),
});

/** The row union the shell renders, discriminated by the report it came from. */
export type ReportRows =
  | { readonly kind: 'attendance-register'; readonly rows: AttendanceRegisterRow[] }
  | { readonly kind: 'punch-audit'; readonly rows: PunchAuditRow[] };

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
