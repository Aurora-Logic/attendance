import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  type AttendanceDaySummary,
  type AttendanceStatus,
  type Paginated,
} from '@vyuha/shared';

/**
 * The Attendance Day contract (REQ-E-01, REQ-E-02), as this client reads it.
 *
 * The endpoint is being written in parallel with these screens, so everything
 * here is parsed at the boundary rather than trusted. The failure mode of an
 * unparsed response is a crash inside a cell renderer whose stack trace names
 * `RecordTable` and says nothing about the server having changed `flags` from
 * an array to a comma-joined string; parsing turns that into the error state
 * every screen here already has.
 *
 * There are two shapes here, and the split is the point. `DayWire` is what the
 * server sends, pinned to `AttendanceDaySummary` from the shared package so
 * the compiler rejects this file the moment the two disagree. `AttendanceDay`
 * is what the screens render. They were written in parallel and drifted -- the
 * server sends `shift: { id, name }`, `firstInAt` and `lastOutAt`; the screens
 * were built expecting `shiftName`, `firstIn` and `lastOut` -- and because
 * nothing tied the parse to the shared type, that drift only surfaced as "the
 * attendance day list came back in a shape this screen cannot read" on a live
 * screen. Parsing the real shape and mapping it once, here, is what stops the
 * next rename from reaching a cell renderer.
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
  /**
   * Zero when the server withheld it, which it does for every viewer holding
   * only `attendance.view.self` (see `canViewOvertime` in `@vyuha/shared`).
   *
   * Zero rather than null so the rest of this client keeps reading a plain
   * number, and safe only because every surface that draws this field asks
   * `useCanViewOvertime()` first, so the placeholder is never rendered. A new
   * screen that plots it without asking would draw a flat zero line for an
   * employee -- ask first.
   */
  otMinutes: number;
  lateMinutes: number;
  /**
   * REQ-J-01 lists Late Arrivals and Early Exits as a mirrored pair of reports,
   * and the wire row has carried this since the contract was written. It was
   * dropped in the mapping while nothing plotted it; the timekeeping chart on
   * My Attendance is the first screen that reads the other half of the pair.
   *
   * Optional for a build reason rather than a contract one, and unlike
   * `otMinutes` above: the server always sends it, and `toAttendanceDay` always
   * sets it. It is declared optional only so day factories written before the
   * field existed still satisfy this type. Make it required once those are
   * updated; until then every reader must default it rather than assume it.
   */
  earlyExitMinutes?: number;
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

/**
 * The server's row, with one deliberate loosening.
 *
 * `flags` is `string[]` here rather than the shared `AttendanceFlag[]` for the
 * reason given on `AttendanceDay.flags`: flags are additive server-side and a
 * day carrying an unknown one must render, not fail the page. Every other
 * field is pinned, so a rename on the server is a compile error in this file
 * instead of a runtime error on a screen.
 */
type DayWire = Omit<AttendanceDaySummary, 'flags'> & { flags: string[] };

const dayWireSchema: z.ZodType<DayWire> = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string() }),
  employeeCode: z.string(),
  date: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
  shift: z.object({ id: z.string(), name: z.string() }).nullable(),
  scheduledIn: clockField,
  scheduledOut: clockField,
  firstInAt: clockField,
  lastOutAt: clockField,
  workedMinutes: z.number(),
  breakMinutes: z.number(),
  // Optional, and that is the permission check landing here rather than a
  // loosening: the server omits the key entirely for a viewer who may not see
  // overtime, so a required field would fail the parse and take the whole
  // screen down with the error state for every employee.
  otMinutes: z.number().optional(),
  lateMinutes: z.number(),
  earlyExitMinutes: z.number(),
  flags: z.array(z.string()),
  isManualOverride: z.boolean(),
  locked: z.boolean(),
});

/** The one place the wire shape becomes the shape the screens render. */
function toAttendanceDay(row: DayWire): AttendanceDay {
  return {
    employee: row.employee,
    date: row.date,
    shiftName: row.shift?.name ?? null,
    // The server sends instants; `formatClock` accepts either an instant or an
    // `HH:mm` string, so the conversion stays in the formatter where the org
    // time zone is applied, rather than being done twice here.
    scheduledIn: row.scheduledIn,
    scheduledOut: row.scheduledOut,
    firstIn: row.firstInAt,
    lastOut: row.lastOutAt,
    workedMinutes: row.workedMinutes,
    otMinutes: row.otMinutes ?? 0,
    lateMinutes: row.lateMinutes,
    earlyExitMinutes: row.earlyExitMinutes,
    status: row.status,
    flags: row.flags,
  };
}

export const attendanceDaySchema = dayWireSchema.transform(toAttendanceDay);

// Left to inference. Annotating the envelope with `z.ZodType<Paginated<...>>`
// forces a claim about the schema's *input* type too, and the input here is
// the wire row rather than the mapped one - which is exactly what the
// transform exists to change. The guarantee that matters is on `dayWireSchema`
// above, where the shape is pinned to the shared contract; `assertDaysShape`
// below keeps the output honest without over-constraining the input.
export const attendanceDaysResponseSchema = z.object({
  data: z.array(attendanceDaySchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/** Fails to compile if the parsed envelope stops being what callers expect. */
const assertDaysShape = (value: z.infer<typeof attendanceDaysResponseSchema>): Paginated<AttendanceDay> => value;
export type { DayWire };
void assertDaysShape;

export type { AttendanceStatus };
