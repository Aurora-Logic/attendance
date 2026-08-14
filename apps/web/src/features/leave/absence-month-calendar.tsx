import { createContext, useContext, useMemo, type ComponentProps } from 'react';

import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { toDateParam } from '@/features/attendance/format';
import { toneClasses } from '@/features/attendance/status';
import { cn } from '@/lib/utils';

import { awayCount, entriesByDate, warningsByDate } from './team-calendar';
import type { LeaveCalendarEntry, LeaveCalendarWarning } from './team-calendar';

/**
 * REQ-G-12's month view: a grid of how thin each day is, not a list of leave.
 *
 * A list answers "who applied"; a manager holding a fourth request is asking
 * "what does that Thursday already look like", and only a grid answers that at
 * a glance. Two tones from the same six families the attendance and holiday
 * calendars use, so the three screens read as one system: a day with somebody
 * away is outlined info, a day the server flagged is filled destructive — and
 * the flag wins, because that is the one a decision turns on.
 *
 * The count is a positioned child rather than a second `<span>`: the day button
 * styles `[&>span]` at `text-xs opacity-70`, which at that specificity would
 * win over anything set here and would dim the date itself to match.
 *
 * Like the holiday grid, the tint goes on the day *button* through `cn()`
 * rather than through `modifiersClassNames`: react-day-picker concatenates
 * modifier classes without merging, so a tint and the built-in `today`
 * background both land as background utilities and the winner depends on
 * Tailwind's emit order.
 */

const AWAY_TONE = toneClasses('info', 'outline');
const BREACH_TONE = toneClasses('destructive', 'filled');

interface DayLoad {
  away: number;
  breached: boolean;
  names: readonly string[];
}

const LoadContext = createContext<Map<string, DayLoad>>(new Map());

/** The tooltip, truncated so a shutdown does not produce one taller than the screen. */
function loadTitle(load: DayLoad): string {
  const shown = load.names.slice(0, 4).join(', ');
  const rest = load.names.length - 4;
  return `${String(load.away)} away: ${shown}${rest > 0 ? ` and ${String(rest)} more` : ''}`;
}

function AbsenceDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const byDate = useContext(LoadContext);
  // Outside days belong to the neighbouring month; tinting one would report a
  // load the month on screen does not carry.
  const load = props.modifiers.outside ? undefined : byDate.get(toDateParam(props.day.date));

  return (
    <CalendarDayButton
      {...props}
      title={load === undefined ? undefined : loadTitle(load)}
      className={cn(
        'aspect-auto h-full tabular-nums',
        load === undefined ? undefined : load.breached ? BREACH_TONE : AWAY_TONE,
        props.className,
      )}
    >
      {props.children}
      {load === undefined ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center text-[0.625rem] leading-none font-semibold"
        >
          {load.away}
        </span>
      )}
    </CalendarDayButton>
  );
}

const CALENDAR_COMPONENTS = { DayButton: AbsenceDayButton };

interface AbsenceMonthCalendarProps {
  /** Any date inside the month to show. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** Undefined shows the whole month in the list below; a date narrows it. */
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  entries: readonly LeaveCalendarEntry[];
  warnings: readonly LeaveCalendarWarning[];
}

export function AbsenceMonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  entries,
  warnings,
}: AbsenceMonthCalendarProps) {
  const load = useMemo(() => {
    const grouped = entriesByDate(entries);
    const breaches = warningsByDate(warnings);
    const map = new Map<string, DayLoad>();
    for (const [date, rows] of grouped) {
      map.set(date, {
        away: awayCount(rows),
        breached: breaches.has(date),
        names: [...new Set(rows.map((row) => row.employee.name))],
      });
    }
    return map;
  }, [entries, warnings]);

  return (
    // The side padding goes at 360px for the reason the holiday grid documents:
    // seven cells at the coarse-pointer floor need 7x44 = 308px, and a padded
    // container offers 286 — the last column arrives half-cut.
    <div className="flex flex-col gap-3 border py-3 max-sm:px-0 sm:p-3">
      <LoadContext.Provider value={load}>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={onMonthChange}
          selected={selected}
          onSelect={onSelect}
          weekStartsOn={1}
          components={CALENDAR_COMPONENTS}
          // The grid fills its surface rather than sitting in a 250px block on
          // the left, and reaches a thumb-sized 44px on a coarse pointer.
          // `aspect-square` cannot come with it: the component sizes a cell
          // from its width, which at full width renders 155px-tall rows.
          className="w-full [--cell-size:--spacing(10)] pointer-coarse:[--cell-size:--spacing(11)]"
          classNames={{
            root: 'w-full',
            month: 'w-full',
            day: 'group/day relative h-(--cell-size) w-full p-0 text-center select-none',
          }}
        />
      </LoadContext.Provider>

      {/* Only the tones actually present are legended. Explaining "over the
          threshold" in a month that has none spends two lines of a phone
          screen on nothing. */}
      {entries.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 max-sm:px-3">
          <li className="flex items-center gap-1.5 text-[0.6875rem]">
            <span aria-hidden className={cn('size-3 shrink-0 border', AWAY_TONE)} />
            <span className="text-muted-foreground">Someone away</span>
          </li>
          {warnings.length > 0 ? (
            <li className="flex items-center gap-1.5 text-[0.6875rem]">
              <span aria-hidden className={cn('size-3 shrink-0 border', BREACH_TONE)} />
              <span className="text-muted-foreground">Over the threshold</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
