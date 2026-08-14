import { useState } from 'react';
import { ArrowLeftIcon, ClockCounterClockwiseIcon, LockKeyIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { AuditEntryDetail } from './audit-entry-detail';
import { actorLabel, printInstant } from './format';
import { EMPTY_FILTERS, humaniseAction, type AuditEntry } from './types';
import { useAuditLog } from './use-audit-log';

/**
 * REQ-M-02's second half: what changed on *this* record.
 *
 * The audit viewer answers "what happened in the organisation"; this answers
 * "what happened to the person, the day, the leave, the settings I am looking
 * at". `GET /audit-logs` has accepted an `entityId` filter since it was
 * written and nothing sent one, so the second question could not be asked.
 *
 * One sheet, two states: a list of entries, and one entry in full. Selecting a
 * row swaps the body rather than opening a second sheet on top of the first --
 * this is itself sometimes opened from inside a sheet (the attendance day), and
 * three stacked surfaces on a phone is a screen nobody can find their way out
 * of. The detail body is the same component the audit viewer renders, so there
 * is one diff renderer in the product and not two.
 */

interface RecordHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** As written by the service that audits this record: `employee`, `settings`, … */
  entityType: string;
  /** Null keeps the sheet closed; a record with no id has no history to filter. */
  entityId: string | null;
  /** Names the record, not the type: "Asha Menon", "12-08-2026". */
  title: string;
  /** One line saying what kind of record this is. */
  description: string;
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading this record's history">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden className="flex flex-col gap-1.5 border-b py-3 last:border-b-0">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-56" />
        </div>
      ))}
    </div>
  );
}

export function RecordHistorySheet({
  open,
  onOpenChange,
  ...record
}: RecordHistorySheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {/* Keyed and mounted only while open, the way every other sheet in this
            product holds its draft. That is what puts the body back on the list
            when it is reopened or pointed at a different record -- the
            alternative was two effects calling setState, which is a cascading
            render and a lint error, and is state React can reset for free. */}
        {open ? <HistoryBody key={record.entityId ?? 'none'} {...record} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryBody({
  entityType,
  entityId,
  title,
  description,
}: Omit<RecordHistorySheetProps, 'open' | 'onOpenChange'>) {
  const canView = usePermission(PERMISSIONS.AUDIT_VIEW);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const query = useAuditLog(
    { ...EMPTY_FILTERS, entityType, entityId },
    { enabled: canView && entityId !== null },
  );

  const rows = (query.data?.pages ?? []).flatMap((page) => page.value.data);

  return (
    <>
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle className="flex min-w-0 items-center gap-2">
            {selected === null ? null : (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to the history list"
                className="pointer-coarse:size-11 -ml-2 shrink-0"
                onClick={() => {
                  setSelected(null);
                }}
              >
                <ArrowLeftIcon />
              </Button>
            )}
            <span className="truncate">
              {selected === null ? `History — ${title}` : humaniseAction(selected.action)}
            </span>
          </SheetTitle>
          <SheetDescription>
            {selected === null
              ? description
              : `${printInstant(selected.createdAt)} by ${actorLabel(selected)}`}
          </SheetDescription>
        </SheetHeader>

        {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto
            and would grow past the sheet instead of scrolling inside it. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {!canView ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LockKeyIcon />
                </EmptyMedia>
                <EmptyTitle>You cannot read the audit trail</EmptyTitle>
                <EmptyDescription>
                  This needs the audit.view permission. The trail records who did what to whose
                  record, so it is not shown more widely.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : selected !== null ? (
            <AuditEntryDetail entry={selected} />
          ) : (
            <>
              {query.isPending ? <ListSkeleton /> : null}

              {query.isError ? (
                <QueryErrorAlert
                  error={query.error}
                  subject="this record's history"
                  onRetry={() => {
                    void query.refetch();
                  }}
                />
              ) : null}

              {query.isSuccess && rows.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ClockCounterClockwiseIcon />
                    </EmptyMedia>
                    <EmptyTitle>Nothing recorded against this record</EmptyTitle>
                    <EmptyDescription>
                      Every change writes a row here and no code path can skip it, so an empty
                      history means nothing has been changed since the record was made — or that it
                      was created before the trail covered it.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}

              {rows.length > 0 ? (
                <>
                  <ul className="flex flex-col divide-y">
                    {rows.map((entry) => (
                      <li key={entry.id}>
                        <Item
                          size="sm"
                          className="min-h-11 cursor-pointer rounded-none px-0"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelected(entry);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelected(entry);
                            }
                          }}
                        >
                          <ItemContent className="min-w-0 gap-0.5">
                            <ItemTitle className="truncate">
                              {humaniseAction(entry.action)}
                            </ItemTitle>
                            <ItemDescription className="truncate text-xs">
                              {printInstant(entry.createdAt)} · {actorLabel(entry)}
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      </li>
                    ))}
                  </ul>

                  {query.hasNextPage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="pointer-coarse:min-h-11 self-start"
                      disabled={query.isFetchingNextPage}
                      onClick={() => {
                        void query.fetchNextPage();
                      }}
                    >
                      {query.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
                      {query.isFetchingNextPage ? 'Loading' : 'Load older entries'}
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
    </>
  );
}

/**
 * The button that opens it, so five screens do not each choose a different
 * icon and a different word for the same thing (CLAUDE.md §3 rule 4).
 */
export function RecordHistoryButton({
  onClick,
  label = 'History',
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="pointer-coarse:min-h-11"
      disabled={disabled}
      onClick={onClick}
    >
      <ClockCounterClockwiseIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}
