import type { HolidayCalendarRecord, HolidayRecord } from '@vyuha/shared';

export {
  holidayCalendarRecordSchema,
  holidayRecordSchema,
  type HolidayImportAction,
  type HolidayImportReport,
  type HolidayImportRow,
  type HolidayImportRowResult,
  type RecomputeSummary,
} from '@vyuha/shared';

/**
 * REQ-H-01: multiple named calendars, each a list of dated holidays with an
 * optional restricted flag. Employees inherit one from their location
 * (REQ-H-02), which is why a calendar carries a location name rather than the
 * screen joining that in itself.
 *
 * The shapes and their parsers come from `@vyuha/shared`, where the API builds
 * its responses from the same definitions. A second hand-written copy of the
 * contract was the thing most likely to drift the first time the server added
 * a field -- which is exactly what `restrictedAllowance` was.
 */
export type Holiday = HolidayRecord;

/**
 * The server always sends `restrictedAllowance`; the development sample set
 * does not, because a sample calendar has no REQ-H-03 policy configured and
 * inventing one would be inventing policy. Optional here, defaulted at the two
 * places that read it, and required by `holidayCalendarRecordSchema` -- so a
 * real response missing it is still a contract break the screen reports.
 */
export type HolidayCalendar = Omit<HolidayCalendarRecord, 'restrictedAllowance'> & {
  restrictedAllowance?: number;
};

/** REQ-H-03: zero means this calendar does not offer restricted holidays. */
export function allowanceOf(calendar: HolidayCalendar): number {
  return calendar.restrictedAllowance ?? 0;
}
