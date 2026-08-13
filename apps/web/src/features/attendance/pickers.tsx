import { useState, type ReactElement, type ReactNode } from 'react';
import { CalendarBlankIcon, ClockIcon } from '@phosphor-icons/react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { formatClock, toDateParam } from './format';

/**
 * Date, month, range and time entry, composed from shadcn primitives.
 *
 * CLAUDE.md §3 is explicit that these are the single most common place the
 * rule gets broken, and equally explicit about why: a native date or time
 * input renders differently in every browser and is close to unusable on a
 * phone. So there is no `<input type="date">` and no picker library anywhere
 * in this module - these four controls are it, and every screen uses them.
 *
 * They live here rather than in `components/shared` only because that
 * directory is locked while three agents are editing this app; they are
 * general-purpose and belong there.
 */

/**
 * Optional external control of the open state.
 *
 * PRD §6.4 gives F2 and Alt+F2 to "change date" and "change period", which
 * means a keystroke has to be able to open a picker that the reader has not
 * clicked. Uncontrolled by default so the common case stays a one-line
 * control, controlled when a shortcut owns it.
 */
interface OpenControl {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PickerSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens the surface. Rendered as the trigger. */
  trigger: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  /** Rendered pinned to the bottom edge of the phone sheet only. */
  footer?: ReactNode;
}

/**
 * The same picker, arriving from the right place for the device.
 *
 * CLAUDE.md §3: a picker opens as a bottom Sheet on small screens rather than
 * a desktop popover. That is a markup difference, not a styling one - the two
 * surfaces have different structure and different dismissal - so it switches
 * on `useIsMobile()` rather than on a CSS breakpoint.
 */
function PickerSurface({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
}: PickerSurfaceProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger render={trigger} />
        {/* A flex column with a scrolling middle: the title and the actions
            stay pinned while a twelve-month year list moves past them. */}
        <SheetContent side="bottom" className="max-h-[85vh] gap-0">
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto
              and would push the footer off the sheet instead of scrolling. */}
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4">
            {children}
          </div>
          {footer ? <SheetFooter className="shrink-0 border-t">{footer}</SheetFooter> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-auto">
        {/* Named for assistive technology even though the calendar beneath is
            self-explanatory to a sighted reader. */}
        <PopoverTitle className="sr-only">{title}</PopoverTitle>
        <PopoverDescription className="sr-only">{description}</PopoverDescription>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Cell sizing for a calendar a thumb has to hit.
 *
 * The component ships `--cell-size: 28px` for a dense desktop, which is the
 * right default here and far too small on a phone. The pointer query raises
 * the whole grid rather than only the button, because the global 44px floor in
 * `index.css` raises the button's height alone and would leave 28px-wide
 * columns with overlapping hit areas.
 */
const TOUCH_CALENDAR = 'pointer-coarse:[--cell-size:--spacing(11)]';

/** Uncontrolled unless the caller passes `open`, in which case it defers. */
function useOpenState(control: OpenControl): [boolean, (next: boolean) => void] {
  const [internal, setInternal] = useState(false);
  const open = control.open ?? internal;
  return [
    open,
    (next: boolean) => {
      setInternal(next);
      control.onOpenChange?.(next);
    },
  ];
}

interface DateFieldProps extends OpenControl {
  value: Date;
  onValueChange: (value: Date) => void;
  /** The accessible name, e.g. "Muster date". */
  label: string;
  /** Rendered inside the trigger, before the date. */
  hint?: ReactNode;
  disabled?: (date: Date) => boolean;
  className?: string;
}

/** One date, written dd-MM-yyyy (REQ-L-01). */
export function DateField({
  value,
  onValueChange,
  label,
  hint,
  disabled,
  className,
  ...control
}: DateFieldProps) {
  const [open, setOpen] = useOpenState(control);

  return (
    <PickerSurface
      open={open}
      onOpenChange={setOpen}
      title={label}
      description="Pick a date."
      trigger={
        <Button
          variant="outline"
          aria-label={label}
          className={cn('justify-start gap-2 tabular-nums', className)}
        >
          <CalendarBlankIcon data-icon="inline-start" />
          {formatDate(toDateParam(value))}
          {hint}
        </Button>
      }
    >
      <Calendar
        mode="single"
        required
        selected={value}
        defaultMonth={value}
        disabled={disabled}
        onSelect={(next: Date) => {
          onValueChange(next);
          setOpen(false);
        }}
        className={TOUCH_CALENDAR}
      />
    </PickerSurface>
  );
}

interface DateRangeFieldProps extends OpenControl {
  value: DateRange;
  onValueChange: (value: DateRange) => void;
  label: string;
  hint?: ReactNode;
  className?: string;
}

/** A from/to range, for a roster period or a report window (Alt+F2). */
export function DateRangeField({
  value,
  onValueChange,
  label,
  hint,
  className,
  ...control
}: DateRangeFieldProps) {
  const [open, setOpen] = useOpenState(control);

  const printed =
    value.from && value.to
      ? `${formatDate(toDateParam(value.from))} – ${formatDate(toDateParam(value.to))}`
      : 'Pick a period';

  return (
    <PickerSurface
      open={open}
      onOpenChange={setOpen}
      title={label}
      description="Pick the first and last day of the period."
      trigger={
        <Button
          variant="outline"
          aria-label={label}
          className={cn('justify-start gap-2 tabular-nums', className)}
        >
          <CalendarBlankIcon data-icon="inline-start" />
          {printed}
          {hint}
        </Button>
      }
      footer={
        <Button
          className="w-full"
          onClick={() => {
            setOpen(false);
          }}
        >
          Done
        </Button>
      }
    >
      {/* The surface stays open after the first click on purpose: a range needs
          two, and closing on the first would look like the control losing the
          selection. */}
      <Calendar
        mode="range"
        selected={value}
        defaultMonth={value.from}
        onSelect={(next: DateRange | undefined) => {
          // Clicking the selected start clears the range. `from: undefined`
          // rather than `{}` because that is what the library's own type calls
          // an empty range, and the caller should not have to know two shapes.
          onValueChange(next ?? { from: undefined });
        }}
        className={TOUCH_CALENDAR}
      />
    </PickerSurface>
  );
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface MonthFieldProps extends OpenControl {
  /** Any date inside the wanted month. Only year and month are read. */
  value: Date;
  onValueChange: (value: Date) => void;
  label: string;
  hint?: ReactNode;
  className?: string;
}

/**
 * A month, as two Selects rather than a calendar.
 *
 * A day grid is the wrong instrument for choosing a month - it makes the
 * reader pick an arbitrary day and hope the screen ignores it. Two lists are
 * exact, and they are two taps on a phone instead of a horizontal scroll
 * through twelve month headers.
 */
export function MonthField({
  value,
  onValueChange,
  label,
  hint,
  className,
  ...control
}: MonthFieldProps) {
  const [open, setOpen] = useOpenState(control);
  const thisYear = new Date().getFullYear();
  // A five-year window either side. Attendance history does not start before
  // the product did, and nobody rosters four years ahead.
  const years = Array.from({ length: 7 }, (_, index) => thisYear - 5 + index);

  return (
    <PickerSurface
      open={open}
      onOpenChange={setOpen}
      title={label}
      description="Pick a month and year."
      trigger={
        <Button
          variant="outline"
          aria-label={label}
          className={cn('min-w-40 justify-start gap-2', className)}
        >
          <CalendarBlankIcon data-icon="inline-start" />
          <span className="tabular-nums">
            {MONTH_NAMES[value.getMonth()]} {value.getFullYear()}
          </span>
          {hint}
        </Button>
      }
      footer={
        <Button
          className="w-full"
          onClick={() => {
            setOpen(false);
          }}
        >
          Done
        </Button>
      }
    >
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Select
          value={String(value.getMonth())}
          onValueChange={(next: string | null) => {
            if (next === null) return;
            onValueChange(new Date(value.getFullYear(), Number(next), 1));
          }}
        >
          <SelectTrigger aria-label="Month" className="pointer-coarse:h-11 w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={String(value.getFullYear())}
          onValueChange={(next: string | null) => {
            if (next === null) return;
            onValueChange(new Date(Number(next), value.getMonth(), 1));
          }}
        >
          <SelectTrigger aria-label="Year" className="pointer-coarse:h-11 w-full sm:w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </PickerSurface>
  );
}

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
/** Five-minute steps. Shift boundaries are not set to the minute in practice. */
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

interface TimeFieldProps extends OpenControl {
  /** `HH:mm`. */
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A wall-clock time, as two Selects behind the same surface as the date
 * pickers. Never `<input type="time">` - see the note at the top of this file.
 */
export function TimeField({
  value,
  onValueChange,
  label,
  disabled,
  className,
  ...control
}: TimeFieldProps) {
  const [open, setOpen] = useOpenState(control);
  const [hour = '00', minute = '00'] = formatClock(value).split(':');

  return (
    <PickerSurface
      open={open}
      onOpenChange={setOpen}
      title={label}
      description="Pick an hour and a minute."
      trigger={
        <Button
          variant="outline"
          aria-label={label}
          disabled={disabled}
          className={cn('w-full justify-start gap-2 tabular-nums', className)}
        >
          <ClockIcon data-icon="inline-start" />
          {formatClock(value)}
        </Button>
      }
      footer={
        <Button
          className="w-full"
          onClick={() => {
            setOpen(false);
          }}
        >
          Done
        </Button>
      }
    >
      <div className="flex w-full items-center gap-2">
        <Select
          value={hour}
          onValueChange={(next: string | null) => {
            if (next !== null) onValueChange(`${next}:${minute}`);
          }}
        >
          <SelectTrigger aria-label={`${label} hour`} className="pointer-coarse:h-11 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h} className="tabular-nums">
                  {h}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <span aria-hidden className="text-muted-foreground text-sm">
          :
        </span>

        <Select
          value={minute}
          onValueChange={(next: string | null) => {
            if (next !== null) onValueChange(`${hour}:${next}`);
          }}
        >
          <SelectTrigger aria-label={`${label} minute`} className="pointer-coarse:h-11 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {MINUTES.map((m) => (
                <SelectItem key={m} value={m} className="tabular-nums">
                  {m}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </PickerSurface>
  );
}
