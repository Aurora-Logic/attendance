import { createContext, useContext, useMemo, type ComponentProps } from 'react';

import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { toneClasses } from '@/features/attendance/status';
import { cn } from '@/lib/utils';

import type { Holiday } from './types';

/**
 * A month of one holiday calendar, laid out the way My Attendance lays out a
 * month (REQ-H-01). A list of dates answers "when is Diwali"; a grid answers
 * "how does this month actually fall", which is the question somebody planning
 * leave around a long weekend is asking.
 *
 * Two tones rather than eight, from the same six families the attendance
 * calendar uses, so the two screens are one system: a public holiday is
 * filled, a restricted one is outlined. That is the same two-dimensional rule
 * as attendance — the family says what kind of day it is, the treatment
 * separates a settled day from an elective one (REQ-H-03).
 *
 * The tint goes on the day *button* through `cn()`, not on the cell through
 * `modifiersClassNames`: react-day-picker concatenates modifier classes
 * without merging, so a tint and the built-in `today` background both land as
 * background utilities and the winner depends on Tailwind's emit order.
 *
 * The day map arrives by context rather than by closing over it in a component
 * defined during render, which would give every day button a new component
 * type whenever the data changed and remount the whole grid.
 */

const PUBLIC_TONE = toneClasses('info', 'filled');
const RESTRICTED_TONE = toneClasses('info', 'outline');

const HolidayContext = createContext<Map<string, Holiday>>(new Map());

function HolidayDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const byDate = useContext(HolidayContext);
  const holiday = byDate.get(toDateKey(props.day.date));

  return (
    <CalendarDayButton
      {...props}
      // The holiday's name is the reason the day is coloured, and a tint with
      // no name is a puzzle. Outside days belong to the neighbouring month and
      // are left uncoloured rather than borrowing a holiday from it.
      title={holiday && !props.modifiers.outside ? holiday.name : undefined}
      className={cn(
        'aspect-auto h-full tabular-nums',
        holiday && !props.modifiers.outside
          ? holiday.restricted
            ? RESTRICTED_TONE
            : PUBLIC_TONE
          : undefined,
        props.className,
      )}
    />
  );
}

const CALENDAR_COMPONENTS = { DayButton: HolidayDayButton };

/**
 * Local rather than `toISOString().slice(0, 10)`: a holiday is a date, not an
 * instant (NFR-05), and converting through UTC moves it a day for anyone east
 * of Greenwich after mid-afternoon.
 */
function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

interface HolidayMonthCalendarProps {
  /** Any date inside the month to show. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /**
   * Every holiday in the loaded year; the grid shows the month's. Readonly
   * because it is the parsed API response, and this component only reads it --
   * a mutable parameter would invite a sort in place that reorders the list
   * the table above is rendering from.
   */
  holidays: readonly Holiday[];
}

export function HolidayMonthCalendar({
  month,
  onMonthChange,
  holidays,
}: HolidayMonthCalendarProps) {
  const byDate = useMemo(
    () => new Map(holidays.map((holiday) => [holiday.date, holiday])),
    [holidays],
  );

  // Only the tones actually present are legended. Explaining "restricted" in a
  // month that contains none is two lines of a phone screen spent on nothing.
  const present = useMemo(() => {
    const monthKey = `${String(month.getFullYear())}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = holidays.filter((holiday) => holiday.date.startsWith(monthKey));
    return {
      public: inMonth.some((holiday) => !holiday.restricted),
      restricted: inMonth.some((holiday) => holiday.restricted),
    };
  }, [holidays, month]);

  return (
    // The horizontal padding goes at 360px. Seven cells at the coarse-pointer
    // floor need 7x44 = 308px, and the padded container offers 286, so the
    // grid was clipped by 22px — the last column half-cut. Dropping the side
    // padding below sm gives it 310 and nothing else on the page changes; the
    // legend keeps its own inset so it still lines up with the text above.
    <div className="flex flex-col gap-3 border py-3 max-sm:px-0 sm:p-3">
      <HolidayContext.Provider value={byDate}>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={onMonthChange}
          weekStartsOn={1}
          components={CALENDAR_COMPONENTS}
          // The grid fills its surface rather than sitting in a 250px block on
          // the left, and the cells reach a thumb-sized 44px on a coarse
          // pointer. `aspect-square` cannot come with it: the component sizes a
          // cell from its width, which at full width renders 155px-tall rows.
          // Height is pinned to --cell-size instead.
          className="w-full [--cell-size:--spacing(9)] pointer-coarse:[--cell-size:--spacing(11)]"
          classNames={{
            root: 'w-full',
            month: 'w-full',
            day: 'group/day relative h-(--cell-size) w-full p-0 text-center select-none',
          }}
        />
      </HolidayContext.Provider>

      {present.public || present.restricted ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 max-sm:px-3">
          {present.public ? (
            <li className="flex items-center gap-1.5 text-[0.6875rem]">
              <span aria-hidden className={cn('size-3 shrink-0 border', PUBLIC_TONE)} />
              <span className="text-muted-foreground">Public</span>
            </li>
          ) : null}
          {present.restricted ? (
            <li className="flex items-center gap-1.5 text-[0.6875rem]">
              <span aria-hidden className={cn('size-3 shrink-0 border', RESTRICTED_TONE)} />
              <span className="text-muted-foreground">Restricted</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
