import { useState } from 'react';
import {
  ArrowsClockwiseIcon,
  KeyIcon,
  LockKeyIcon,
  PlugIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { formatDistanceToNow, parseISO } from 'date-fns';

import { CopyField } from '@/components/shared/copy-field';
import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
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
import { useCreateConnection, useIntegrations, useIssueToken } from './use-integrations';

/**
 * Technical design §14 / PRD §5: the Tally seam, now with its two writes.
 *
 * Phase 0 shipped this read-only and said so on screen, because a button with
 * no endpoint behind it teaches the reader to distrust the whole screen. The
 * endpoints exist now (Phase 6b), so the buttons do: create a connection, and
 * issue — or rotate — its agent token. The token is shown exactly once, in
 * the dialog that issued it; only its hash survives on the server, so there
 * is nothing a later screen could show.
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

  const create = useCreateConnection();
  const issue = useIssueToken();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyGuid, setCompanyGuid] = useState('');

  /** The rotation being confirmed, then the token being shown — one at a time. */
  const [rotating, setRotating] = useState<IntegrationConnection | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  function submitCreate() {
    create.mutate(
      {
        name: name.trim(),
        ...(companyName.trim() === '' ? {} : { companyName: companyName.trim() }),
        ...(companyGuid.trim() === '' ? {} : { companyGuid: companyGuid.trim() }),
      },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: 'Connection created',
            description: 'Issue its agent token next; the agent cannot connect without one.',
          });
          setAdding(false);
          setName('');
          setCompanyName('');
          setCompanyGuid('');
        },
      },
    );
  }

  function runIssue(connection: IntegrationConnection) {
    issue.mutate(
      { connectionId: connection.id },
      {
        onSuccess: (result) => {
          setRotating(null);
          setIssuedToken(result.token);
        },
      },
    );
  }

  const columns: RecordColumn<IntegrationConnection>[] = [
    {
      key: 'name',
      header: 'Connection',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'company',
      header: 'Tally company',
      cell: (row) => row.companyName ?? EMPTY_VALUE,
      secondary: true,
    },
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
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={issue.isPending}
          onClick={() => {
            issue.reset();
            if (row.tokenIssued) setRotating(row);
            else runIssue(row);
          }}
        >
          <KeyIcon data-icon="inline-start" />
          {row.tokenIssued ? 'Rotate token' : 'Issue token'}
        </Button>
      ),
    },
  ];

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
          <div className="flex items-center gap-2">
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
            <Button
              size="sm"
              onClick={() => {
                create.reset();
                setAdding(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Add connection
            </Button>
          </div>
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
                One connection per Tally company (a Tally installation holding four financial
                years as four companies is four connections). Add the first, then issue its agent
                token — the agent cannot report in without one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.name}
              mobileStatus={(row) => (
                <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              )}
              mobileSupporting={(row) =>
                `${row.companyName ?? row.system} · last heartbeat ${heartbeatAge(row.lastHeartbeatAt)}`
              }
            />

            {/* A status word is not enough on this screen: "Never connected"
                and "Heartbeat overdue" are different problems with different
                fixes, and REQ-Q-05 stores which specific problem an ERROR is.
                The stale window is the server's own number, read from the
                response rather than restated here. */}
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

      <Dialog
        open={adding}
        onOpenChange={(next) => {
          if (!next) setAdding(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a Tally connection</DialogTitle>
            <DialogDescription>
              One connection per Tally company (REQ-Q-03). The company GUID can be bound later,
              but no job runs until it is.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="connection-name">Connection name</Label>
              <Input
                id="connection-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Head office 2026-27"
                maxLength={80}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="connection-company">Tally company name</Label>
              <Input
                id="connection-company"
                value={companyName}
                onChange={(event) => {
                  setCompanyName(event.target.value);
                }}
                placeholder="G C Communication (2026-27)"
                maxLength={120}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="connection-guid">Company GUID, if known</Label>
              <Input
                id="connection-guid"
                value={companyGuid}
                onChange={(event) => {
                  setCompanyGuid(event.target.value);
                }}
                placeholder="Copied from Tally; the agent reports it on its first heartbeat"
                maxLength={80}
              />
            </div>
            {create.isError ? (
              <Alert variant="destructive">
                <AlertTitle>The connection was not created</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAdding(false);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={name.trim() === '' || create.isPending}
              onClick={submitCreate}
            >
              {create.isPending ? 'Creating' : 'Create connection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={rotating !== null}
        onOpenChange={(next) => {
          if (!next) setRotating(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the token for {rotating?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The current token stops working the moment the new one is issued, and the running
              agent is disconnected until it is reconfigured with the new token. Rotation is how a
              credential is revoked; there is no separate revoke.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {issue.isError ? (
            <Alert variant="destructive">
              <AlertTitle>The token was not rotated</AlertTitle>
              <AlertDescription>{issue.error.message}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={issue.isPending}
              onClick={(event) => {
                // Stays open while the request runs, so the error state has
                // somewhere to land; success closes it via runIssue.
                event.preventDefault();
                if (rotating !== null) runIssue(rotating);
              }}
            >
              {issue.isPending ? 'Rotating' : 'Rotate token'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={issuedToken !== null}
        onOpenChange={(next) => {
          if (!next) setIssuedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agent token — shown once</DialogTitle>
            <DialogDescription>
              Paste this into the agent's configuration on the Tally machine now. Only its hash is
              stored here, so closing this dialog is final: a lost token means issuing a new one.
            </DialogDescription>
          </DialogHeader>
          {issuedToken === null ? null : (
            <CopyField value={issuedToken} label="Agent token" id="issued-agent-token" />
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setIssuedToken(null);
              }}
            >
              I have stored it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
