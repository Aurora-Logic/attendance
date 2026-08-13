import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * Holiday calendars and restricted holidays (REQ-H-01 to REQ-H-04).
 *
 * Owned by one slice. The barrel already exports this file, so the slice
 * that fills it in never has to touch index.ts and cannot race another.
 *
 * One definition of every shape, parsed by the API and reused by the web
 * client's forms -- the same arrangement as `org.ts`. The read shapes below are
 * what `GET /holiday-calendars` already answers with, so a screen and a
 * controller cannot disagree about what a calendar is.
 */

/**
 * A date without a time. NFR-05: "Date-only fields (attendance date, leave
 * date, holiday) are stored as DATE and never as timestamps", so the wire
 * format is `YYYY-MM-DD` and never an instant -- an ISO instant would move
 * Diwali by a day for anyone east of Greenwich after mid-afternoon.
 *
 * `z.iso.date()` accepts the shape; the refinement rejects the dates that shape
 * allows but the calendar does not, such as 2026-02-30, which Postgres would
 * refuse later with a message naming a column rather than a field.
 */
export const calendarDateSchema = z.iso.date().refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, 'must be a real calendar date');

/**
 * The years a calendar may be filed under.
 *
 * Bounded rather than open: a mistyped year is otherwise indistinguishable
 * from a deliberate one, and a calendar for the year 202 would sort ahead of
 * every real one forever.
 */
export const HOLIDAY_YEAR_MIN = 2000;
export const HOLIDAY_YEAR_MAX = 2100;

export const holidayYearSchema = z.coerce
  .number()
  .int()
  .min(HOLIDAY_YEAR_MIN)
  .max(HOLIDAY_YEAR_MAX);

const holidayNameSchema = z.string().trim().min(1).max(120);
const calendarNameSchema = z.string().trim().min(1).max(120);

/**
 * REQ-H-03's N. Capped so a typo cannot hand out an allowance larger than the
 * year; the real number is a small one and the ceiling only has to be absurd.
 */
export const restrictedAllowanceSchema = z.number().int().min(0).max(365);

// ------------------------------------------------------------------- reads

export interface HolidayRecord {
  readonly id: string;
  /** `YYYY-MM-DD`. A holiday is a date, never an instant (NFR-05). */
  readonly date: string;
  readonly name: string;
  /** REQ-H-01's "optional restricted/optional flag". */
  readonly restricted: boolean;
}

export interface HolidayCalendarRecord {
  readonly id: string;
  readonly name: string;
  readonly year: number;
  /**
   * REQ-H-02: the locations whose employees inherit this calendar. Names
   * rather than ids because the only consumer is a line of prose under the
   * calendar's title, and an id would send the screen back for a second query.
   */
  readonly locations: readonly string[];
  /** REQ-H-03: how many of the restricted holidays below one employee may take. */
  readonly restrictedAllowance: number;
  readonly holidays: readonly HolidayRecord[];
}

export const holidayRecordSchema: z.ZodType<HolidayRecord> = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
  restricted: z.boolean(),
});

export const holidayCalendarRecordSchema: z.ZodType<HolidayCalendarRecord> = z.object({
  id: z.string(),
  name: z.string(),
  year: z.number().int(),
  locations: z.array(z.string()),
  restrictedAllowance: z.number().int(),
  holidays: z.array(holidayRecordSchema),
});

/**
 * `GET /holiday-calendars?year=&q=`.
 *
 * The year is optional: without it the list is every calendar the organisation
 * has, which is what a "which years exist" question needs. With it, the screen
 * gets exactly the year it is showing.
 */
export const holidayCalendarListQuerySchema = pageQuerySchema.extend({
  year: holidayYearSchema.optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export type HolidayCalendarListQuery = z.infer<typeof holidayCalendarListQuerySchema>;

// ------------------------------------------------------------------ writes

export const createHolidayCalendarSchema = z.object({
  name: calendarNameSchema,
  year: holidayYearSchema,
  restrictedAllowance: restrictedAllowanceSchema.default(0),
});

export type CreateHolidayCalendarInput = z.infer<typeof createHolidayCalendarSchema>;

/**
 * The year is absent on purpose. A calendar's year is half of its identity --
 * the unique index is (org, name, year) and every holiday in it was entered
 * against that year -- so moving it would silently re-date a whole list.
 * Creating next year's calendar is the supported path.
 */
export const updateHolidayCalendarSchema = z
  .object({
    name: calendarNameSchema,
    restrictedAllowance: restrictedAllowanceSchema,
  })
  .partial();

export type UpdateHolidayCalendarInput = z.infer<typeof updateHolidayCalendarSchema>;

export const createHolidaySchema = z.object({
  date: calendarDateSchema,
  name: holidayNameSchema,
  restricted: z.boolean().default(false),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const updateHolidaySchema = z
  .object({
    date: calendarDateSchema,
    name: holidayNameSchema,
    restricted: z.boolean(),
  })
  .partial();

export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

// ------------------------------------------------------------- bulk import

/**
 * REQ-H-04: "Bulk import a year's holidays from Excel."
 *
 * The endpoint takes rows, not a file. Technical design §6 splits the employee
 * import the same way (`/employees/import/validate | commit`): the sheet is
 * turned into rows by whatever read it, and the server's job is to say what
 * each row would do before it does it. That keeps one contract whether the
 * rows came from a spreadsheet, a clipboard paste, or a later Tally sync.
 */
export const IMPORT_MAX_ROWS = 400;

export const holidayImportRowSchema = z.object({
  date: calendarDateSchema,
  name: holidayNameSchema,
  restricted: z.boolean().default(false),
});

export type HolidayImportRow = z.infer<typeof holidayImportRowSchema>;

export const holidayImportSchema = z.object({
  rows: z.array(holidayImportRowSchema).min(1).max(IMPORT_MAX_ROWS),
  /**
   * Whether a date already in the calendar is overwritten by the sheet.
   *
   * Defaults to false, so re-running an import is safe and the second run
   * reports "unchanged" rather than quietly renaming dates somebody edited by
   * hand afterwards. Turning it on is how a corrected sheet is re-applied.
   */
  overwriteExisting: z.boolean().default(false),
});

export type HolidayImportInput = z.infer<typeof holidayImportSchema>;

/**
 * What one row of the sheet would do, or why it would do nothing. Reported by
 * `/validate` before anything is written and again by `/commit` after.
 */
export const HOLIDAY_IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED', 'SKIPPED', 'ERROR'] as const;
export type HolidayImportAction = (typeof HOLIDAY_IMPORT_ACTIONS)[number];

export interface HolidayImportRowResult {
  /** 1-based, so it names the same row the reader is looking at in the sheet. */
  readonly row: number;
  readonly date: string;
  readonly name: string;
  readonly restricted: boolean;
  readonly action: HolidayImportAction;
  /** Present for SKIPPED and ERROR, absent otherwise. */
  readonly message?: string;
}

export interface HolidayImportReport {
  readonly calendarId: string;
  readonly year: number;
  /** True for `/validate`: nothing was written, whatever the actions say. */
  readonly dryRun: boolean;
  readonly rows: readonly HolidayImportRowResult[];
  readonly counts: Readonly<Record<HolidayImportAction, number>>;
  /**
   * REQ-H-04: "Changing a holiday recomputes the affected days unless locked."
   * Absent on a dry run, because nothing changed and nothing was recomputed.
   */
  readonly recompute?: RecomputeSummary;
}

/**
 * The result of REQ-H-04's recompute, so the effect of a holiday change is
 * something a caller can see rather than something they have to trust.
 */
export interface RecomputeSummary {
  /** Employee-days the change touched. */
  readonly considered: number;
  readonly recomputed: number;
  /** REQ-E-09: inside a locked period, so deliberately left alone. */
  readonly locked: number;
  /**
   * Days the engine refused -- an employee with no shift for the date, most
   * often (REQ-C-04). Counted rather than swallowed, and logged with the
   * reason; a holiday must not fail to save because somebody's roster is
   * incomplete.
   */
  readonly failed: number;
}

// ------------------------------------------------------ restricted holidays

/** One holiday from the pool, with whether this employee has taken it. */
export interface RestrictedHolidayOption extends HolidayRecord {
  readonly elected: boolean;
}

/**
 * REQ-H-03, read side: the pool, the allowance, and what is left of it.
 *
 * `remaining` is served rather than left to the client to subtract. Two places
 * doing that arithmetic is two places for it to disagree, and the client's copy
 * is the one that decides whether the button is enabled.
 */
export interface RestrictedHolidayPool {
  readonly employeeId: string;
  readonly calendarId: string | null;
  readonly year: number;
  readonly allowance: number;
  readonly used: number;
  readonly remaining: number;
  readonly options: readonly RestrictedHolidayOption[];
}

export const restrictedHolidayQuerySchema = z.object({
  /**
   * Optional, and a filter rather than a selector.
   *
   * An employee is attached to one calendar (REQ-H-02) and a calendar belongs
   * to one year, so the pool is already determined without a year. Passing one
   * asks "the pool, if it is this year's" and answers with an empty pool when
   * it is not -- which is what a screen showing 2027 needs when the employee is
   * still pointed at the 2026 calendar. Guessing at a same-named calendar in
   * the asked-for year would be inventing an inheritance rule REQ-H-02 does
   * not have.
   */
  year: holidayYearSchema.optional(),
  /**
   * Whose pool. Absent means the caller's own employee record; naming someone
   * else is what needs `holiday.manage`, and the server decides that -- not
   * the presence of the field.
   */
  employeeId: z.uuid().optional(),
});

export type RestrictedHolidayQuery = z.infer<typeof restrictedHolidayQuerySchema>;

export const electRestrictedHolidaySchema = z.object({
  holidayId: z.uuid(),
  employeeId: z.uuid().optional(),
});

export type ElectRestrictedHolidayInput = z.infer<typeof electRestrictedHolidaySchema>;

/**
 * Election and withdrawal both answer with the whole pool rather than the one
 * row that moved: the allowance the screen has to redraw changed too, and a
 * response carrying only the election would make the client guess at it.
 */
export interface RestrictedHolidayResult {
  readonly pool: RestrictedHolidayPool;
  readonly recompute: RecomputeSummary;
}
