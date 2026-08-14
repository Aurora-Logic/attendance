import { ArrowsClockwiseIcon, LockKeyIcon, PlugIcon } from '@phosphor-icons/react';
import { formatDistanceToNow, parseISO } from 'date-fns';

import { PageHeader } from '@/components/shared/page-header';
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
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { EMPTY_VALUE } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import {
  STATUS_LABELS,
  STATUS_VARIANT,
  statusExplanation,
  type IntegrationConnection,
} from './types';
import { useIntegrations } from './use-integrations';

/**
 * Technical design §14 / PRD §5: the Tally seam.
 *
 * Phase 0 scope is deliberately narrow: the tables and the provider interface
 * exist so Phase 6 is additive, and the stubbed provider only heartbeats. The
 * screen therefore reports a connection's state and does not pretend to manage
 * one -- there is nothing behind a Connect button yet, and a button that fails
 * on every press teaches the reader to distrust the whole screen.
 */

/**
 * "Never", not a dash. A connection that has never been heard from is a fact
 * about the connection, and an em dash reads as a missing value.
 */
function heartbeatAge(value: string | null): string {
  if (value === null) return 'Never';
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return `${formatDistanceToNow(parsed)} ago`;
}

const COLUMNS: RecordColumn<IntegrationConnection>[] = [
  {
    key: 'name',
    header: 'Connection',
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  { key: 'system', header: 'System', cell: (row) => row.system },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>,
  },
  {
    key: 'heartbeat',
    header: 'Last heartbeat',
    cell: (row) => heartbeatAge(row.lastHeartbeatAt),
    className: 'tabular-nums',
  },
  {
    key: 'token',
    header: 'Agent token',
    cell: (row) => (row.tokenIssued ? 'Issued' : 'Not issued'),
    secondary: true,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading integrations" className="border">
      {Array.from({ length: 2 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-40 shrink-0" />
          <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function IntegrationsPage() {
  const canManage = usePermission(PERMISSIONS.INTEGRATION_MANAGE);
  const query = useIntegrations({ enabled: canManage });
  const rows = query.data?.data ?? [];
  const staleAfterMinutes = query.data?.staleAfterMinutes ?? null;

  if (!canManage) {
    return (
      <>
        <PageHeader description="Connections to systems outside this application." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view integration connections</EmptyTitle>
            <EmptyDescription>
              This needs the integration.manage permission. A connection carries a credential the
              agent authenticates with, so the list is not shown more widely.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Connections to systems outside this application. TallyPrime is the first."
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <ArrowsClockwiseIcon data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        {query.isPending ? <ListSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="integrations"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>No connections</EmptyTitle>
              <EmptyDescription>
                This is the expected state today. A connection is created when the Tally agent is
                installed on the machine that runs TallyPrime and is given a token. Nothing syncs
                until then, and attendance does not depend on it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.name}
              mobileStatus={(row) => (
                <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              )}
              mobileSupporting={(row) =>
                `${row.system} · last heartbeat ${heartbeatAge(row.lastHeartbeatAt)}`
              }
            />

            {/* A status word is not enough on this screen: "Never connected"
                and "Heartbeat overdue" are different problems with different
                fixes, and the reader has no other place to learn which. The
                stale window is the server's own number, read from the response
                rather than restated here. */}
            <dl className="flex flex-col gap-2 border p-4 text-sm">
              {rows.map((row) => (
                <div key={row.id} className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium">{row.name}</dt>
                  <dd className="text-muted-foreground text-xs">
                    {statusExplanation(row, staleAfterMinutes ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        <Alert>
          <PlugIcon />
          <AlertTitle>Creating and rotating a connection is not built yet</AlertTitle>
          <AlertDescription>
            Issuing an agent token is a credential operation and there is no endpoint behind it in
            this phase, so this screen reports state and changes nothing. Until then a connection
            is created by the deployment that installs the agent.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-3 border p-4">
          <SectionHeading
            title="How the Tally agent connects"
            note="Technical design section 14."
          />
          <ol className="text-muted-foreground flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              The agent runs on the machine that runs TallyPrime and talks to it on localhost port
              9000. That port never faces the internet.
            </li>
            <li>
              Every call is outbound from the agent to this application, so no inbound firewall
              rule is needed at the office.
            </li>
            <li>
              The agent authenticates with a per-connection token. Only its hash is stored here,
              and the token itself is shown once when it is issued.
            </li>
            <li>
              Each call updates the heartbeat. A heartbeat that stops arriving turns the status
              stale and raises a notification, rather than failing silently.
            </li>
            <li>
              Masters are matched by Tally GUID, never by name. A name match is a suggestion for a
              person to confirm; two employees with the same name is not hypothetical.
            </li>
          </ol>
        </div>
      </div>
    </>
  );
}
