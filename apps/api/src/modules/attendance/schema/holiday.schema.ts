import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, organizations } from '../../../platform/db/schema/index.js';

/**
 * REQ-H-01. Admin-entered; "no dates ship assumed" (05-decisions), so the
 * seed creates an empty calendar for the current year and nothing else.
 */
export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    year: integer('year').notNull(),
    /**
     * REQ-H-03's N: how many of this calendar's restricted holidays one
     * employee may elect in its year (migration 0007).
     *
     * On the calendar rather than in `settings` because the pool and the count
     * are one policy: a state calendar with four optional festivals and a
     * calendar with none cannot share a number, and a number kept away from
     * the pool it limits is a number that drifts from it.
     *
     * Zero -- the default -- means this calendar does not run restricted
     * holidays. Questionnaire Q36 ("how many may each person take?") has no
     * answer yet, and 05-decisions says no dates ship assumed; an invented
     * allowance would be the same assumption wearing a different hat.
     */
    restrictedAllowance: integer('restricted_allowance').notNull().default(0),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('holiday_calendars_org_name_year_uq').on(t.orgId, t.name, t.year).where(ALIVE),
    index('holiday_calendars_org_year_idx').on(t.orgId, t.year),
  ],
);

/**
 * REQ-H-02. A restricted holiday is only a holiday for the employees who
 * elected it (REQ-H-03), so `is_restricted` changes how the day engine reads
 * the row rather than describing it.
 */
export const holidays = pgTable(
  'holidays',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    isRestricted: boolean('is_restricted').notNull().default(false),
    ...standardColumns(),
  },
  (t) => [
    // One entry per calendar per date. Two rows for the same day would make the
    // engine's holiday lookup order-dependent, and therefore not deterministic.
    uniqueIndex('holidays_calendar_date_uq').on(t.calendarId, t.date).where(ALIVE),
    index('holidays_org_date_idx').on(t.orgId, t.date),
  ],
);

/** REQ-H-03: the employee picks N restricted holidays for the leave year. */
export const restrictedHolidayElections = pgTable(
  'restricted_holiday_elections',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    holidayId: uuid('holiday_id')
      .notNull()
      .references(() => holidays.id, { onDelete: 'cascade' }),
    leaveYear: integer('leave_year').notNull(),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('restricted_elections_employee_holiday_uq')
      .on(t.employeeId, t.holidayId)
      .where(ALIVE),
    index('restricted_elections_year_idx').on(t.orgId, t.employeeId, t.leaveYear),
  ],
);
