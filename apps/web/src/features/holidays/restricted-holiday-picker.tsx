import { CalendarStarIcon, CheckIcon, PlusIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy, apiErrorCopy } from '@/features/leave/api-error-copy';
import { formatDate } from '@/lib/format';

import {
  allowanceSentence,
  poolBlocker,
  recomputeSentence,
  sortedOptions,
  type RestrictedHolidayOption,
} from './restricted-holidays';
import { useElectRestrictedHoliday, useRestrictedHolidayPool } from './use-restricted-holidays';

/**
 * REQ-H-03, the employee as the actor: "employee chooses up to N per year from
 * the pool; the choice consumes an allowance and marks the day HOLIDAY for
 * them only."
 *
 * An administrator could already mark a holiday restricted and set an
 * allowance on the calendar; nobody could take one. This is the missing half.
 *
 * The allowance is stated as both numbers rather than as "1 left", because
 * somebody deciding between two festivals needs the denominator. It comes from
 * the server's `remaining` and is never re-derived here — the same number
 * gates the button, and two subtractions of the same figures is one place too
 * many for them to disagree.
 *
 * A withdrawal has no confirmation dialog. It is reversible while the
 * allowance permits, and the toast reports what the server actually did to the
 * attendance day, which is the fact worth knowing.
 */

const BLOCKER_COPY = {
  NO_CALENDAR: {
    title: 'No holiday calendar is attached to you',
    description:
      'Restricted holidays come from the calendar your location follows. An administrator attaches one before there is anything to choose.',
  },
  NOT_ENABLED: {
    title: 'Your calendar does not offer restricted holidays',
    description:
      'The calendar runs no restricted-holiday allowance this year, so every holiday on it applies to everybody. An administrator sets an allowance if that changes.',
  },
  NONE_LISTED: {
    title: 'No restricted holidays are listed yet',
    description:
      'Your calendar has an allowance but no holiday on it is marked restricted. They appear here as soon as one is.',
  },
} as const;

interface RestrictedHolidayPickerProps {
  /** Whose pool. Null for an account with no employee record (REQ-B-02). */
  employeeId: string | null;
}

export function RestrictedHolidayPicker({ employeeId }: RestrictedHolidayPickerProps) {
  // Asked for as "the caller's own": the endpoint defaults to the signed-in
  // employee, and naming somebody else is the privileged act. Passing an id
  // here would make the employee's own screen look like an administrative one.
  const query = useRestrictedHolidayPool({ enabled: employeeId !== null });
  const election = useElectRestrictedHoliday();

  const pool = query.data;
  const options = sortedOptions(pool);
  const blocker = poolBlocker(pool);

  function run(option: RestrictedHolidayOption) {
    election.mutate(
      { holidayId: option.id, action: option.elected ? 'WITHDRAW' : 'ELECT' },
      {
        onSuccess: (result) => {
          toast.add({
            type: 'success',
            title: option.elected
              ? `${option.name} given back`
              : `${option.name} taken as your restricted holiday`,
            description: `${allowanceSentence(result.pool)} ${recomputeSentence(result.recompute)}`,
          });
        },
        onError: (error) => {
          // The server's own sentence, not a paraphrase: it names the actual
          // refusal — the day is not restricted, the allowance is spent, it is
          // on a calendar this person does not follow.
          const copy = actionErrorCopy(error, option.elected ? 'Giving the day back' : 'Taking the day');
          toast.add({ type: 'error', title: copy.title, description: copy.description });
        },
      },
    );
  }

  const columns: RecordColumn<RestrictedHolidayOption>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (row) => <span className="font-medium tabular-nums">{formatDate(row.date)}</span>,
    },
    { key: 'name', header: 'Holiday', cell: (row) => row.name },
    {
      key: 'state',
      header: 'State',
      cell: (row) =>
        row.elected ? (
          <Badge variant="secondary">
            <CheckIcon data-icon="inline-start" />
            Taken
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">Available</span>
        ),
    },
    {
      key: 'action',
      header: '',
      className: 'text-right',
      cell: (row) => <ElectionButton option={row} onRun={run} pending={election.isPending} pool={pool} />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Restricted holidays"
        note="Optional holidays on your calendar. Taking one uses part of your yearly allowance and marks that day a holiday for you alone."
        action={
          pool && pool.allowance > 0 ? (
            <Badge variant={pool.remaining > 0 ? 'default' : 'secondary'} className="tabular-nums">
              {pool.remaining > 0
                ? `${String(pool.remaining)} of ${String(pool.allowance)} left`
                : `${String(pool.allowance)} of ${String(pool.allowance)} taken`}
            </Badge>
          ) : null
        }
      />

      {employeeId === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarStarIcon />
            </EmptyMedia>
            <EmptyTitle>This sign-in is not linked to an employee record</EmptyTitle>
            <EmptyDescription>
              A restricted holiday is taken by a person, so an account with no employee record has
              no pool of its own. An administrator can link the two.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {query.isPending && employeeId !== null ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading restricted holidays"
          className="border"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              aria-hidden
              className="flex min-h-14 items-center gap-4 border-b px-3 py-2.5 last:border-b-0 md:min-h-9"
            >
              <Skeleton className="h-3 w-24 shrink-0" />
              <Skeleton className="h-3 w-32 shrink-0" />
              <Skeleton className="ml-auto h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {
              apiErrorCopy(query.error, {
                subject: 'restricted holidays',
                permission: 'attendance.view.self',
              }).title
            }
          </AlertTitle>
          <AlertDescription>
            {
              apiErrorCopy(query.error, {
                subject: 'restricted holidays',
                permission: 'attendance.view.self',
              }).description
            }
          </AlertDescription>
        </Alert>
      ) : null}

      {blocker !== null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarStarIcon />
            </EmptyMedia>
            <EmptyTitle>{BLOCKER_COPY[blocker].title}</EmptyTitle>
            <EmptyDescription>{BLOCKER_COPY[blocker].description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {options.length > 0 && blocker === null ? (
        <>
          <p className="text-muted-foreground text-xs">{pool ? allowanceSentence(pool) : null}</p>
          <RecordTable
            columns={columns}
            rows={[...options]}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.name}
            mobileStatus={(row) => (
              <ElectionButton option={row} onRun={run} pending={election.isPending} pool={pool} />
            )}
            mobileSupporting={(row) => `${formatDate(row.date)}${row.elected ? ' · taken' : ''}`}
          />
        </>
      ) : null}
    </section>
  );
}

/**
 * Take, or give back.
 *
 * When the allowance is spent, an untaken day's button is disabled with the
 * reason on it rather than removed: an employee looking for Diwali needs to
 * find out *why* they cannot take it, and a row that simply has no control
 * reads as a rendering fault.
 */
function ElectionButton({
  option,
  onRun,
  pending,
  pool,
}: {
  option: RestrictedHolidayOption;
  onRun: (option: RestrictedHolidayOption) => void;
  pending: boolean;
  pool: { remaining: number } | undefined;
}) {
  const exhausted = !option.elected && (pool?.remaining ?? 0) <= 0;

  return (
    <Button
      variant={option.elected ? 'ghost' : 'outline'}
      size="sm"
      disabled={pending || exhausted}
      title={exhausted ? 'Your allowance for this year is fully taken.' : undefined}
      onClick={() => {
        onRun(option);
      }}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : option.elected ? (
        <XIcon data-icon="inline-start" />
      ) : (
        <PlusIcon data-icon="inline-start" />
      )}
      {option.elected ? 'Give back' : exhausted ? 'None left' : 'Take'}
    </Button>
  );
}
