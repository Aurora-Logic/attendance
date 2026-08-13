import { toDateParam } from '@/features/attendance/format';

import { allowanceOf, type Holiday, type HolidayCalendar } from './types';

/**
 * What the two edit sheets hold while they are open, and how one is built from
 * a row the reader clicked.
 *
 * A module of its own rather than exports beside the components: a file that
 * exports both a component and a plain function loses React Fast Refresh for
 * the whole file, so an edit to the sheet remounts the page and throws away
 * whatever was half-typed in it. The lint rule that says so is the reason, and
 * the reason is a real one.
 */

export interface CalendarDraft {
  /** Absent for a new calendar. */
  id?: string;
  name: string;
  year: number;
  restrictedAllowance: number;
}

export function draftFromCalendar(calendar: HolidayCalendar): CalendarDraft {
  return {
    id: calendar.id,
    name: calendar.name,
    year: calendar.year,
    restrictedAllowance: allowanceOf(calendar),
  };
}

export function newCalendarDraft(year: number): CalendarDraft {
  return { name: '', year, restrictedAllowance: 0 };
}

export interface HolidayDraft {
  calendarId: string;
  /** Absent for a new holiday. */
  id?: string;
  date: string;
  name: string;
  restricted: boolean;
  /** Bounds the picker to the calendar's own year; the server refuses the rest. */
  year: number;
}

export function newHolidayDraft(calendarId: string, year: number, month: Date): HolidayDraft {
  // Opens on the month the reader is looking at rather than on 1 January,
  // which would send them stepping back through the year on every add.
  const start = month.getFullYear() === year ? month : new Date(year, 0, 1);
  return { calendarId, date: toDateParam(start), name: '', restricted: false, year };
}

export function draftFromHoliday(
  holiday: Holiday,
  calendarId: string,
  year: number,
): HolidayDraft {
  return {
    calendarId,
    id: holiday.id,
    date: holiday.date,
    name: holiday.name,
    restricted: holiday.restricted,
    year,
  };
}
