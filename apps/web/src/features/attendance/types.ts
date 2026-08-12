import { z } from 'zod';

import { ATTENDANCE_STATUSES, type AttendanceStatus, type Paginated } from '@vyuha/shared';

/**
 * The Attendance Day contract (REQ-E-01, REQ-E-02), as this client reads it.
 *
 * The endpoint is being written in parallel with these screens, so everything
 * here is parsed at the boundary rather than trusted. The failure mode of an
 * unparsed response is a crash inside a cell renderer whose stack trace names
 * `RecordTable` and says nothing about the server having changed `flags` from
 * an array to a comma-joined string; parsing turns that into the error state
 * every screen here already has.
 */

export interface AttendanceDayEmployee {
  id: string;
  name: string;
}

export interface AttendanceDay {
  employee: AttendanceDayEmployee;
  /** Date-only `YYYY-MM-DD`. NFR-05: an attendance date is not an instant. */
  date: string;
  /** Null on a day with no roster and no default shift. */
  shiftName: string | null;
  /** Wall-clock `HH:mm` in the org timezone, not an instant. */
  scheduledIn: string | null;
  scheduledOut: string | null;
  /** Null until the employee punches; a day exists before either punch does. */
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  status: AttendanceStatus;
  /**
   * REQ-E-04. Deliberately `string[]` rather than the shared enum: flags are
   * additive on the server and a day carrying one this build has never heard
   * of should render with a humanised label, not fail the whole page. Status
   * is the opposite — it is a closed set that decides colour and meaning, so
   * an unknown one is a real contract break and is treated as one.
   */
  flags: string[];
}

const clockField = z.string().nullable();

export const attendanceDaySchema: z.ZodType<AttendanceDay> = z.object({
  employee: z.object({ id: z.string(), name: z.string() }),
  date: z.string(),
  shiftName: z.string().nullable(),
  scheduledIn: clockField,
  scheduledOut: clockField,
  firstIn: clockField,
  lastOut: clockField,
  workedMinutes: z.number(),
  otMinutes: z.number(),
  lateMinutes: z.number(),
  status: z.enum(ATTENDANCE_STATUSES),
  flags: z.array(z.string()),
});

export const attendanceDaysResponseSchema: z.ZodType<Paginated<AttendanceDay>> = z.object({
  data: z.array(attendanceDaySchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

export type { AttendanceStatus };
