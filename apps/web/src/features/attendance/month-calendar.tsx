import { type ComponentProps, createContext, createElement, useContext, useMemo } from 'react';
import { ATTENDANCE_STATUS_ICONS } from '@/components/shared/entity-icons';

import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@vyuha/shared';

import { toDateParam } from './format';
import { statusClasses, statusLabel } from './status';
import type { AttendanceDay } from './types';

/**
 * A month of attendance, coloured by status (REQ-E-02).
 *
 * The colour is applied to the day *button* rather than to the day cell,
 * through the component's own `cn()`. Applying it to the cell via
 * `modifiersClassNames` looked simpler and was wrong: react-day-picker
 * concatenates modifier classes without merging them, so a status tint and the
 * built-in `today` background both land as `background-color` utilities and
 * which one wins depends on the order Tailwind happened to emit them in.
 * Going through `cn()` makes tailwind-merge resolve it deterministically.
 *
 * The day map is passed by context rather than by closing over it in a
 * component defined during render, which would give every day button a new
 * component type on each data change and remount the whole grid.
 */

const DayStatusContext = createContext<Map<string, AttendanceDay>>(new Map());

function StatusDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const byDate = useContext(DayStatusContext);
  const day = byDate.get(toDateParam(props.day.date));

  return (
    <CalendarDayButton
      {...props}
      className={cn(
        'aspect-auto h-full tabular-nums',
        // Outside days belong to the neighbouring month and have no record
        // here, so they stay uncoloured rather than borrowing a status.
        day && !props.modifiers.outside ? statusClasses(day.status) : undefined,
        props.className,
      )}
    />
  );
}

const CALENDAR_COMPONENTS = { DayButton: StatusDayButton };

interface MonthCalendarProps {
  /** Any date inside the month to show. */
  month: Date;
  onMonthChange: (month: Date) => void;
  days: AttendanceDay[];
  selected: Date | undefined;
  onSelectDay: (date: Date) => void;
}

export function MonthCalendar({
  month,
  onMonthChange,
  days,
  selected,
  onSelectDay,
}: MonthCalendarProps) {
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  // Only the statuses actually present are legended. A fixed list of eight
  // would spend a third of a 360px screen explaining states this month does
  // not contain.
  const present = useMemo(() => {
    const seen = new Set(days.map((day) => day.status));
    return ATTENDANCE_STATUSES.filter((status) => seen.has(status));
  }, [days]);

  return (
    <div className="flex flex-col gap-3 border p-3">
      <DayStatusContext.Provider value={byDate}>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={onMonthChange}
          selected={selected}
          onSelect={(next: Date | undefined) => {
            if (next) onSelectDay(next);
          }}
          weekStartsOn={1}
          components={CALENDAR_COMPONENTS}
          // The grid fills the surface it sits on rather than sitting in a
          // 250px block against the left edge, and the cells grow to a
          // thumb-sized 44px where the pointer is coarse.
          //
          // `aspect-square` has to go with it. The component sizes a cell by
          // its width, which is fine in a 250px block and absurd at full
          // width: a 1440px month rendered 155px-tall rows and pushed the list
          // three screens down. Height is pinned to --cell-size instead.
          className="w-full [--cell-size:--spacing(9)] pointer-coarse:[--cell-size:--spacing(11)]"
          classNames={{
            root: 'w-full',
            month: 'w-full',
            day: 'group/day relative h-(--cell-size) w-full p-0 text-center select-none',
          }}
        />
      </DayStatusContext.Provider>

      {present.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3">
          {present.map((status) => (
            <li key={status} className="flex items-center gap-1.5 text-[0.6875rem]">
              <span
                aria-hidden
                className={cn('size-3 shrink-0 border', statusClasses(status))}
              />
              <StatusGlyph status={status} />
              <span className="text-muted-foreground">{statusLabel(status)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The status's own glyph beside its swatch (owner, 22 Aug 2026), the same one the pill wears. */
function StatusGlyph({ status }: { status: AttendanceStatus }) {
  return createElement(ATTENDANCE_STATUS_ICONS[status], { 'aria-hidden': true, className: 'text-muted-foreground size-3' });
}
