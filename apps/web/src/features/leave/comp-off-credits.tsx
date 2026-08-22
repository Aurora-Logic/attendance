import { HourglassMediumIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toDateParam } from '@/features/attendance/format';
import { formatDate } from '@/lib/format';

import { apiErrorCopy } from './api-error-copy';
import {
  COMP_OFF_STATES,
  COMP_OFF_STATE_LABELS,
  availableDays,
  compOffUrgency,
  expiringSoon,
  expiryNote,
  type CompOffState,
  type CompOffUrgency,
} from './comp-off';
import { formatDays } from './leave-days';
import type { CompOffCredit } from './types';
import { useCompOffCredits } from './use-leave';

/**
 * REQ-G-11, the employee's side.
 *
 * The balance band above already shows the comp-off closing balance, so this
 * section is not here to restate a number — it is here to say *when the number
 * disappears*. Credits expire 30 days from the earned date and the job warns at
 * 7 days and again at 2, which means a credit nobody can see is a credit
 * somebody loses. The expiry is therefore the loud column, and anything inside
 * the job's own warning window is raised into an alert above the list rather
 * than left as a date in a row.
 *
 * The list is not paginated: a hundred credits is already far past what an
 * organisation this size grants in a year, and a person's own credits are a
 * working set rather than an archive.
 */

const URGENCY_VARIANT: Record<CompOffUrgency, 'default' | 'secondary' | 'outline' | 'destructive'> =
  {
    CRITICAL: 'destructive',
    SOON: 'default',
    ACTIVE: 'secondary',
    CONSUMED: 'outline',
    LAPSED: 'outline',
  };

const URGENCY_LABEL: Record<CompOffUrgency, string> = {
  CRITICAL: 'Expiring',
  SOON: 'Expiring soon',
  ACTIVE: 'Available',
  CONSUMED: 'Used',
  LAPSED: 'Expired',
};

function columnsFor(today: string): RecordColumn<CompOffCredit>[] {
  return [
    {
      key: 'earnedForDate',
      header: 'Earned for',
      cell: (row) => <span className="font-medium tabular-nums">{formatDate(row.earnedForDate)}</span>,
    },
    {
      key: 'days',
      header: 'Days',
      cell: (row) => formatDays(row.days),
      numeric: true,
    },
    {
      key: 'expiresOn',
      header: 'Expires',
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{formatDate(row.expiresOn)}</span>
          <span className="text-muted-foreground text-xs">{expiryNote(row, today)}</span>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) => {
        const urgency = compOffUrgency(row, today);
        return <Badge variant={URGENCY_VARIANT[urgency]}>{URGENCY_LABEL[urgency]}</Badge>;
      },
    },
  ];
}

function CreditsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading comp-off credits" className="border">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-14 items-center gap-4 border-b px-3 py-2.5 last:border-b-0 md:min-h-9"
        >
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="h-3 w-12 shrink-0" />
          <Skeleton className="ml-auto h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface CompOffCreditsProps {
  /** Whose credits. Null for an account with no employee record (REQ-B-02). */
  employeeId: string | null;
  state: CompOffState;
  onStateChange: (state: CompOffState) => void;
}

export function CompOffCredits({ employeeId, state, onStateChange }: CompOffCreditsProps) {
  const today = toDateParam(new Date());
  const query = useCompOffCredits(state, { employeeId, enabled: employeeId !== null });

  const credits = query.data?.data ?? [];
  const urgent = expiringSoon(credits, today);
  const available = availableDays(credits);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Comp-off credits"
        note="Earned by working a holiday or a weekly off. Each credit expires 30 days after the date it was earned for."
        action={
          <Select
            value={state}
            onValueChange={(next: string | null) => {
              if (next !== null) onStateChange(next as CompOffState);
            }}
          >
            <SelectTrigger aria-label="Filter credits by state" className="w-40">
              <SelectValue>
                {(value: string) => COMP_OFF_STATE_LABELS[value as CompOffState]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {COMP_OFF_STATES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {COMP_OFF_STATE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      {employeeId === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HourglassMediumIcon />
            </EmptyMedia>
            <EmptyTitle>This sign-in is not linked to an employee record</EmptyTitle>
            <EmptyDescription>
              Comp-off is earned by a person, so an account with no employee record has none of its
              own. An administrator can link the two.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {/* The warning the expiry job sends by e-mail, said again where the
          person is already looking. A date in a table row is not a warning. */}
      {urgent.length > 0 ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {urgent.length === 1
              ? 'One comp-off credit is about to expire'
              : `${String(urgent.length)} comp-off credits are about to expire`}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {urgent.map((credit) => (
                <li key={credit.id}>
                  <span className="font-medium tabular-nums">{formatDays(credit.days)}</span> earned
                  for {formatDate(credit.earnedForDate)}. {expiryNote(credit, today)} Apply for
                  Compensatory Off below to use it.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isPending && employeeId !== null ? <CreditsSkeleton /> : null}

      {query.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {apiErrorCopy(query.error, { subject: 'comp-off credits', permission: 'leave.apply.self' }).title}
          </AlertTitle>
          <AlertDescription>
            {
              apiErrorCopy(query.error, { subject: 'comp-off credits', permission: 'leave.apply.self' })
                .description
            }
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isSuccess && credits.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HourglassMediumIcon />
            </EmptyMedia>
            <EmptyTitle>
              {state === 'ACTIVE'
                ? 'No comp-off credits available'
                : `No ${COMP_OFF_STATE_LABELS[state].toLowerCase()} comp-off credits`}
            </EmptyTitle>
            <EmptyDescription>
              {state === 'ACTIVE'
                ? 'A credit appears here when HR or an approver grants one against a holiday or weekly off you worked.'
                : 'Switch the filter to see credits in another state.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {credits.length > 0 ? (
        <>
          {state === 'ACTIVE' ? (
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium tabular-nums">
                {formatDays(available)}
              </span>{' '}
              available across {String(credits.length)} credit
              {credits.length === 1 ? '' : 's'}.
            </p>
          ) : null}
          <RecordTable
            columns={columnsFor(today)}
            rows={credits}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => `Earned for ${formatDate(row.earnedForDate)}`}
            mobileStatus={(row) => {
              const urgency = compOffUrgency(row, today);
              return <Badge variant={URGENCY_VARIANT[urgency]}>{URGENCY_LABEL[urgency]}</Badge>;
            }}
            mobileSupporting={(row) => `${formatDays(row.days)} · ${expiryNote(row, today)}`}
          />
        </>
      ) : null}
    </section>
  );
}
