import {
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorCopy } from '@/features/leave/api-error-copy';
import { SampleDataNotice } from '@/features/leave/sample-data-notice';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';

import type { Holiday, HolidayCalendar } from './types';
import { useHolidayCalendars } from './use-holidays';

/**
 * REQ-H-01…H-04 / PRD §5 screen 13: the holiday calendars.
 *
 * Calendars are stacked rather than put behind tabs. There are two or three of
 * them, they are compared against each other constantly ("is Diwali on the
 * same day in both offices?"), and a tab strip both hides that comparison and
 * is the first thing to overflow at 360px.
 */

/** Two years back and one forward is the range anyone edits or checks. */
function yearOptions(current: number): number[] {
  return [current - 2, current - 1, current, current + 1];
}

/**
 * The stepper and the menu have to agree on the range, or an arrow walks to a
 * year the menu cannot show and the trigger renders a value with no option
 * behind it.
 */
function yearBounds(current: number): { earliest: number; latest: number } {
  const options = yearOptions(current);
  return { earliest: Math.min(...options), latest: Math.max(...options) };
}

function readYear(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  // A hand-edited URL should land on this year rather than on year NaN.
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return fallback;
  return parsed;
}

const COLUMNS: RecordColumn<Holiday>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (row) => <span className="font-medium">{formatDate(row.date)}</span>,
    className: 'tabular-nums',
  },
  {
    key: 'day',
    header: 'Day',
    // A holiday that lands on a weekly off is worth seeing at a glance: it
    // changes nothing for attendance and everything for a comp-off claim.
    cell: (row) => format(parseISO(row.date), 'EEEE'),
    secondary: true,
  },
  { key: 'name', header: 'Holiday', cell: (row) => row.name },
  {
    key: 'restricted',
    header: 'Type',
    cell: (row) =>
      row.restricted ? (
        <Badge variant="outline">Restricted</Badge>
      ) : (
        <Badge variant="secondary">Public</Badge>
      ),
  },
];

function CalendarSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading holiday calendars" className="flex flex-col gap-6">
      {Array.from({ length: 2 }, (_, calendar) => (
        <div key={calendar} aria-hidden className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <div className="border">
            {Array.from({ length: 4 }, (_, row) => (
              <div
                key={row}
                className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
              >
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
                <Skeleton className="h-3 w-32 shrink-0" />
                <Skeleton className="ml-auto h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarSection({ calendar }: { calendar: HolidayCalendar }) {
  const restricted = calendar.holidays.filter((holiday) => holiday.restricted).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{calendar.name}</h2>
        <p className="text-muted-foreground text-sm">
          <span className="tabular-nums">{calendar.holidays.length}</span> holidays
          {restricted > 0 ? (
            <>
              , <span className="tabular-nums">{restricted}</span> of them restricted
            </>
          ) : null}
          {calendar.locations.length > 0 ? ` · ${calendar.locations.join(', ')}` : null}
        </p>
      </div>

      {calendar.holidays.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDotsIcon />
            </EmptyMedia>
            <EmptyTitle>No holidays in this year</EmptyTitle>
            <EmptyDescription>
              Holidays are entered or imported for each year; nothing is assumed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <RecordTable
          columns={COLUMNS}
          rows={calendar.holidays}
          rowKey={(row) => row.id}
          mobilePrimary={(row) => row.name}
          mobileStatus={(row) =>
            row.restricted ? <Badge variant="outline">Restricted</Badge> : null
          }
          mobileSupporting={(row) => `${formatDate(row.date)} · ${format(parseISO(row.date), 'EEEE')}`}
        />
      )}
    </section>
  );
}

export function HolidaysPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = readYear(searchParams.get('year'), thisYear);
  const { earliest: earliestYear, latest: latestYear } = yearBounds(thisYear);

  const query = useHolidayCalendars(year);
  const calendars = query.data?.data ?? [];
  const sample = query.data?.sample ?? false;

  function setYear(next: string | null) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === null || next === String(thisYear)) params.delete('year');
      else params.set('year', next);
      return params;
    });
  }

  // PRD §6.4: Alt+F2 changes the period. Here the period is the year.
  useShortcut({
    id: 'holidays.change-year',
    keys: 'alt+f2',
    label: 'Change year',
    scope: 'screen',
    run: () => {
      document.getElementById('holiday-year')?.click();
    },
  });

  const copy = apiErrorCopy(query.error, {
    subject: 'holiday calendars',
    permission: 'holiday.manage',
  });

  return (
    <>
      {sample ? <SampleDataNotice endpoint="/api/v1/holiday-calendars" /> : null}

      <PageHeader description="Each calendar is a named list of dated holidays. Employees inherit one from their location." />

      {/* Toolbar row (PRD §6.2), built the same way My Attendance builds its
          month toolbar: a stepper either side of the period control, and a
          reset that only appears when there is something to reset to. Moving
          one year is the common action and was two taps through a menu; it is
          one tap now, and the menu stays for a jump. */}
      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous year"
            disabled={year <= earliestYear}
            className="pointer-coarse:size-11"
            onClick={() => {
              setYear(String(year - 1));
            }}
          >
            <CaretLeftIcon />
          </Button>
          <Select value={String(year)} onValueChange={setYear}>
            <SelectTrigger
              id="holiday-year"
              aria-label="Holiday year"
              className="pointer-coarse:h-11 w-28"
            >
              <SelectValue>
                {(value: string) => <span className="tabular-nums">{value}</span>}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {yearOptions(thisYear).map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    <span className="tabular-nums">{option}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next year"
            // Nothing is entered beyond next year, so stepping further would
            // show an empty calendar that reads as a loading failure.
            disabled={year >= latestYear}
            className="pointer-coarse:size-11"
            onClick={() => {
              setYear(String(year + 1));
            }}
          >
            <CaretRightIcon />
          </Button>
        </ButtonGroup>

        {year === thisYear ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setYear(String(thisYear));
            }}
          >
            This year
          </Button>
        )}

        <ShortcutHint keys="alt+f2" className="hidden md:inline-flex" />
      </div>

      {query.isPending ? <CalendarSkeleton /> : null}

      {query.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>
            {copy.description}
            {query.error instanceof ApiError && query.error.requestId ? (
              <span className="mt-1 block font-mono text-[0.6875rem]">
                Request {query.error.requestId}
              </span>
            ) : null}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch();
              }}
            >
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {query.isSuccess && calendars.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDotsIcon />
            </EmptyMedia>
            <EmptyTitle>No calendars for {year}</EmptyTitle>
            <EmptyDescription>
              Create a calendar per location or state, then enter or import that year&apos;s dates.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {calendars.map((calendar, index) => (
        <div key={calendar.id} className="flex flex-col gap-6">
          {index > 0 ? <Separator /> : null}
          <CalendarSection calendar={calendar} />
        </div>
      ))}
    </>
  );
}
