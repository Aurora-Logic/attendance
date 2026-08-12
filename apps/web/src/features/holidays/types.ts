import { z } from 'zod';

/**
 * REQ-H-01: multiple named calendars, each a list of dated holidays with an
 * optional restricted flag. Employees inherit one from their location
 * (REQ-H-02), which is why a calendar carries a location name rather than the
 * screen joining that in itself.
 */
export interface Holiday {
  id: string;
  name: string;
  /** `yyyy-MM-dd`. A holiday is a date, never an instant (NFR-05). */
  date: string;
  /** REQ-H-03: an optional holiday the employee elects from a pool. */
  restricted: boolean;
}

export interface HolidayCalendar {
  id: string;
  name: string;
  year: number;
  /** Locations that inherit this calendar (REQ-H-02). Empty means none yet. */
  locations: string[];
  holidays: Holiday[];
}

export const holidaySchema: z.ZodType<Holiday> = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  restricted: z.boolean(),
});

export const holidayCalendarSchema: z.ZodType<HolidayCalendar> = z.object({
  id: z.string(),
  name: z.string(),
  year: z.number().int(),
  locations: z.array(z.string()),
  holidays: z.array(holidaySchema),
});
