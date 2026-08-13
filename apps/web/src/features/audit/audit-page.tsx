import { useState } from 'react';
import { LockKeyIcon, ScrollIcon } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toDateParam } from '@/features/attendance/format';
import { DateRangeField } from '@/features/attendance/pickers';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import {
  EMPTY_FILTERS,
  diffRows,
  humaniseAction,
  type AuditEntry,
  type AuditFilters,
} from './types';
import { useAuditFacets, useAuditLog } from './use-audit-log';

/**
 * REQ-M-02 / PRD §5 screen 18: the audit viewer.
 *
 * The list carries who, what and when; the diff, the address and the request id
 * go in a sheet opened from the row. Putting a before/after pair in a table
 * cell would either truncate it into uselessness or make every row a different
 * height, and the request id is the field that turns "it failed for me" into
 * something findable in the server log -- it needs room to be copied, not room
 * to be glanced at.
 */

const ALL = '__all__';

function printInstant(value: string): string {
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  // Date in the organisation's format, time to the minute. Seconds matter for
  // ordering, not for reading, and they are in the sheet.
  return `${formatDate(toDateParam(parsed))} ${format(parsed, 'HH:mm')}`;
}

function actorLabel(entry: AuditEntry): string {
  if (entry.actor === null) return 'System';
  return entry.actor.name ?? entry.actor.email ?? entry.actor.id;
}

const COLUMNS: RecordColumn<AuditEntry>[] = [
  {
    key: 'createdAt',
    header: 'When',
    cell: (row) => printInstant(row.createdAt),
    className: 'tabular-nums whitespace-nowrap',
  },
  {
    key: 'action',
    header: 'Action',
    cell: (row) => <span className="font-medium">{humaniseAction(row.action)}</span>,
  },
  { key: 'entityType', header: 'Entity', cell: (row) => row.entityType },
  { key: 'actor', header: 'By', cell: (row) => actorLabel(row) },
  {
    key: 'impersonator',
    header: 'Acting as',
    // REQ-M-01 keeps both identities. A row with an impersonator is rare and
    // is exactly the row an auditor is looking for, so it is a column rather
    // than a detail.
    cell: (row) =>
      row.impersonator === null ? (
        EMPTY_VALUE
      ) : (
        <Badge variant="destructive">{row.impersonator.email ?? row.impersonator.id}</Badge>
      ),
    secondary: true,
  },
  {
    key: 'ip',
    header: 'From',
    cell: (row) => row.ip ?? EMPTY_VALUE,
    className: 'tabular-nums',
    secondary: true,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the audit log" className="border">
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-3 w-40 shrink-0" />
          <Skeleton className="hidden h-3 w-24 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-3 w-32 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function AuditLogPage() {
  const canView = usePermission(PERMISSIONS.AUDIT_VIEW);

  if (!canView) {
    return (
      <>
        <PageHeader description="Every state-changing action, appended and never edited." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view the audit log</EmptyTitle>
            <EmptyDescription>
              This needs the audit.view permission. The trail records who did what to whose record,
              so it is not shown more widely.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return <AuditLogBody />;
}

function AuditLogBody() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const query = useAuditLog(filters);
  // A failed facet query must not take the trail with it: no options simply
  // means the two dropdowns are not offered.
  const facets = useAuditFacets().data;

  const pages = query.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.value.data);
  const sample = pages.some((page) => page.sample);
  const filtered =
    filters.action !== null ||
    filters.entityType !== null ||
    filters.from !== null ||
    filters.to !== null;

  // PRD §6.4: Alt+F2 changes the period.
  useShortcut({
    id: 'audit.change-period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      setPeriodOpen(true);
    },
  });

  const period: DateRange = {
    from: filters.from ? parseISO(filters.from) : undefined,
    to: filters.to ? parseISO(filters.to) : undefined,
  };

  function setPeriod(next: DateRange) {
    setFilters((current) => ({
      ...current,
      from: next.from ? toDateParam(next.from) : null,
      to: next.to ? toDateParam(next.to) : null,
    }));
  }

  return (
    <>
      <PageHeader description="Every state-changing action, appended and never edited. Nothing here can be deleted." />

      <div className="flex flex-col gap-4">
        {/* Toolbar row (PRD §6.2). Wraps rather than scrolling at 360px. */}
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeField
            value={period}
            onValueChange={setPeriod}
            label="Audit period"
            open={periodOpen}
            onOpenChange={setPeriodOpen}
            hint={<ShortcutHint keys="alt+f2" className="ml-1 hidden md:inline-flex" />}
          />

          <div className="flex w-full gap-2 sm:contents">
            {facets && facets.actions.length > 0 ? (
              <Select
                value={filters.action ?? ALL}
                onValueChange={(next: string | null) => {
                  setFilters((current) => ({
                    ...current,
                    action: next === null || next === ALL ? null : next,
                  }));
                }}
              >
                <SelectTrigger
                  aria-label="Filter by action"
                  className="pointer-coarse:h-11 min-w-0 flex-1 sm:w-56 sm:flex-none"
                >
                  <SelectValue>
                    {(value: string) => (value === ALL ? 'All actions' : humaniseAction(value))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL}>All actions</SelectItem>
                    {facets.actions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {humaniseAction(action)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}

            {facets && facets.entityTypes.length > 1 ? (
              <Select
                value={filters.entityType ?? ALL}
                onValueChange={(next: string | null) => {
                  setFilters((current) => ({
                    ...current,
                    entityType: next === null || next === ALL ? null : next,
                  }));
                }}
              >
                <SelectTrigger
                  aria-label="Filter by entity"
                  className="pointer-coarse:h-11 min-w-0 flex-1 sm:w-44 sm:flex-none"
                >
                  <SelectValue>
                    {(value: string) => (value === ALL ? 'All entities' : value)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL}>All entities</SelectItem>
                    {facets.entityTypes.map((entity) => (
                      <SelectItem key={entity} value={entity}>
                        {entity}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>

          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {sample ? <SampleDataNotice what="audit log" /> : null}

        {query.isPending ? <ListSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="the audit log"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollIcon />
              </EmptyMedia>
              <EmptyTitle>{filtered ? 'Nothing in this period' : 'Nothing recorded yet'}</EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? 'No action matches these filters. Widen the period or clear the filters to see more.'
                  : 'The trail fills as people work. Every successful change writes a row here, and no code path can skip it.'}
              </EmptyDescription>
            </EmptyHeader>
            {filtered ? (
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => humaniseAction(row.action)}
              mobileStatus={(row) => <Badge variant="outline">{row.entityType}</Badge>}
              mobileSupporting={(row) => `${printInstant(row.createdAt)} · ${actorLabel(row)}`}
              onRowActivate={setOpen}
            />

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground min-w-0 flex-1 text-xs">
                {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} loaded, newest first. Open a row
                for the before and after.
              </p>
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => {
                    void query.fetchNextPage();
                  }}
                >
                  {query.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
                  {query.isFetchingNextPage ? 'Loading' : 'Load older entries'}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <AuditEntrySheet
        entry={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </>
  );
}

function AuditEntrySheet({
  entry,
  onOpenChange,
}: {
  entry: AuditEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const rows = entry ? diffRows(entry.before, entry.after) : [];

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {entry ? (
          <>
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle>{humaniseAction(entry.action)}</SheetTitle>
              <SheetDescription>
                {printInstant(entry.createdAt)} by {actorLabel(entry)}
              </SheetDescription>
            </SheetHeader>

            {/* min-h-0 is load-bearing: without it this flex child refuses to
                shrink below its content and scrolls the page instead of
                itself. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex flex-col gap-2">
                <SectionHeading title="What changed" />
                {rows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No field-level diff was recorded. The action itself is the record.
                  </p>
                ) : (
                  <dl className="flex flex-col gap-3 text-sm">
                    {rows.map((row) => (
                      <div key={row.field} className="flex flex-col gap-1">
                        <dt className="font-mono text-xs font-medium">{row.field}</dt>
                        <dd className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                          <span className="text-muted-foreground break-all line-through">
                            {row.before}
                          </span>
                          <span className="break-all">{row.after}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <SectionHeading title="Where it came from" />
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Entity</dt>
                  <dd className="break-all font-medium">
                    {entry.entityType}
                    {entry.entityId === null ? '' : ` ${entry.entityId}`}
                  </dd>

                  <dt className="text-muted-foreground">Actor</dt>
                  <dd className="break-all font-medium">
                    {entry.actor?.email ?? actorLabel(entry)}
                  </dd>

                  {entry.impersonator === null ? null : (
                    <>
                      <dt className="text-muted-foreground">Impersonated by</dt>
                      <dd className="break-all font-medium">
                        {entry.impersonator.email ?? entry.impersonator.id}
                      </dd>
                    </>
                  )}

                  <dt className="text-muted-foreground">Address</dt>
                  <dd className="font-medium tabular-nums">{entry.ip ?? EMPTY_VALUE}</dd>

                  <dt className="text-muted-foreground">Device</dt>
                  <dd className="break-all font-medium">{entry.userAgent ?? EMPTY_VALUE}</dd>

                  <dt className="text-muted-foreground">Request</dt>
                  {/* The field that turns "it failed for me" into something
                      findable in the server log. */}
                  <dd className="font-mono text-xs break-all">{entry.requestId ?? EMPTY_VALUE}</dd>
                </dl>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
