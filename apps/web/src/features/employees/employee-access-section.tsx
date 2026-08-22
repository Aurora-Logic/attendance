import { useMemo, useState } from 'react';
import {
  EnvelopeSimpleIcon,
  KeyIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  TrashIcon,
} from '@phosphor-icons/react';

import { ReasonDialog } from '@/components/shared/reason-dialog';
import { RecordPicker, type PickerOption } from '@/components/shared/record-picker';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useRoles } from '@/features/roles/use-roles';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { PERMISSIONS, employeeDisplayName, type EmployeeDetail } from '@vyuha/shared';

import { EmployeeInviteDialog } from './invite-dialog';
import {
  useAssignRole,
  useEmployeeAccess,
  useRevokeRole,
  type AssignedRole,
} from './use-employee-access';

/**
 * REQ-B-07's assignment control, on the employee record.
 *
 * The requirement's acceptance is "a new role created in the UI grants and
 * denies correctly", and until this existed a role created in the editor could
 * not be handed to anybody (OPEN-QUESTIONS P2-3). The employee record is where
 * an administrator is standing when the question arises, so this is where the
 * control lives rather than on a screen of its own.
 *
 * Roles attach to the *account*, not to the employee row. REQ-B-02 keeps the
 * two separate and REQ-A-06 imports create employees with no login at all, so
 * the section says so plainly instead of showing an empty role list that reads
 * as "this person has no permissions" when the truth is "this person cannot
 * sign in".
 *
 * One role at a time, each with its own reason. A checkbox list with one Save
 * would be fewer presses and would also mean that a batch refused halfway --
 * which the last-holder invariant can do -- had already applied the first half.
 */

const REVOKE_ICON = TrashIcon;

interface EmployeeAccessSectionProps {
  employee: EmployeeDetail;
}

function AccessSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading access and roles"
      className="flex flex-col gap-3 border p-4"
    >
      <Skeleton aria-hidden className="h-3 w-40" />
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} aria-hidden className="flex items-center gap-3">
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function EmployeeAccessSection({ employee }: EmployeeAccessSectionProps) {
  const name = employeeDisplayName(employee.firstName, employee.lastName);

  const access = useEmployeeAccess(employee.id);
  // Only fetched once we know there is an account to assign to. Nothing on this
  // screen can use the list otherwise, and a role list is a map of what
  // everybody in the organisation can do.
  const roles = useRoles({ enabled: access.data?.account != null });

  const [granting, setGranting] = useState<PickerOption | null>(null);
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [revoking, setRevoking] = useState<AssignedRole | null>(null);
  const [manageCredentialsOpen, setManageCredentialsOpen] = useState(false);

  const assign = useAssignRole();
  const revoke = useRevokeRole();

  const held = useMemo(
    () => new Set((access.data?.roles ?? []).map((role) => role.id)),
    [access.data],
  );

  /** Only what they do not already hold. Offering a held role would be a no-op wearing a button. */
  const assignable = useMemo<PickerOption[]>(
    () =>
      (roles.data?.data ?? [])
        .filter((role) => !held.has(role.id))
        .map((role) => ({
          id: role.id,
          label: role.name,
          hint: `${String(role.permissions.length)} permissions`,
        })),
    [roles.data, held],
  );

  const grantedRole = roles.data?.data.find((role) => role.id === granting?.id) ?? null;

  function submitGrant(reason: string) {
    if (granting === null) return;
    assign.mutate(
      { employeeId: employee.id, roleId: granting.id, reason },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: `${granting.label} granted to ${name}`,
            description: 'It takes effect on their very next request. Your reason is in the audit log.',
          });
          setConfirmGrant(false);
          setGranting(null);
        },
      },
    );
  }

  function submitRevoke(reason: string) {
    if (revoking === null) return;
    const role = revoking;
    revoke.mutate(
      { employeeId: employee.id, roleId: role.id, reason },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: `${role.name} removed from ${name}`,
            description: 'It stops applying on their very next request.',
          });
          setRevoking(null);
        },
      },
    );
  }

  const account = access.data?.account ?? null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Access and roles"
        note="A role is a named bundle of permissions, and it attaches to the login account rather than to the employee record."
      />

      {access.isPending ? <AccessSkeleton /> : null}

      {access.isError ? (
        <QueryErrorAlert
          error={access.error}
          subject="access and roles"
          onRetry={() => {
            void access.refetch();
          }}
        />
      ) : null}

      {access.isSuccess && account === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <EnvelopeSimpleIcon />
            </EmptyMedia>
            <EmptyTitle>{name} has no login account</EmptyTitle>
            <EmptyDescription>
              An employee record and a login are separate things. Click below to provide login credentials or send an invite link.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              onClick={() => {
                setManageCredentialsOpen(true);
              }}
            >
              <KeyIcon data-icon="inline-start" />
              Set login credentials
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {access.isSuccess && account !== null ? (
        <div className="flex flex-col gap-4 border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Signs in as</dt>
              <dd className="font-medium break-all">{account.email}</dd>

              <dt className="text-muted-foreground">Account</dt>
              <dd>
                <Badge variant={account.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                  {ACCOUNT_STATUS_LABELS[account.status]}
                </Badge>
              </dd>

              <dt className="text-muted-foreground">Last signed in</dt>
              <dd className="font-medium tabular-nums">
                {account.lastLoginAt === null ? EMPTY_VALUE : formatDate(account.lastLoginAt.slice(0, 10))}
              </dd>
            </dl>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setManageCredentialsOpen(true);
              }}
            >
              <KeyIcon data-icon="inline-start" />
              Manage credentials / password
            </Button>
          </div>

          {account.status === 'SUSPENDED' ? (
            <Alert>
              <ShieldWarningIcon />
              <AlertTitle>This account is suspended</AlertTitle>
              <AlertDescription>
                A suspended account cannot sign in, so a role granted to it would confer nothing.
                The server refuses the grant rather than accepting one that does nothing.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <SectionHeading title="Roles held" />

            {access.data.roles.length === 0 ? (
              <p className="text-muted-foreground border px-3 py-2.5 text-xs">
                No role. This account can sign in and will be refused by every screen, because
                every permission comes from a role.
              </p>
            ) : (
              <ul className="flex flex-col divide-y border">
                {access.data.roles.map((role) => (
                  <li key={role.id}>
                    <Item size="sm" className="min-h-11 rounded-none">
                      <ItemContent className="min-w-0 gap-0.5">
                        <ItemTitle className="truncate">
                          {role.name}
                          {role.isSystem ? (
                            <Badge variant="secondary" className="ml-2">
                              Seeded
                            </Badge>
                          ) : null}
                        </ItemTitle>
                        <ItemDescription className="truncate text-xs">
                          {role.permissions.length === 0
                            ? 'Grants nothing'
                            : `${String(role.permissions.length)} permissions${
                                role.description === null ? '' : ` · ${role.description}`
                              }`}
                        </ItemDescription>
                      </ItemContent>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        aria-label={`Remove ${role.name} from ${name}`}
                        disabled={revoke.isPending}
                        onClick={() => {
                          revoke.reset();
                          setRevoking(role);
                        }}
                      >
                        <REVOKE_ICON data-icon="inline-start" />
                        Remove
                      </Button>
                    </Item>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <SectionHeading
              title="Grant a role"
              note="Takes effect on their next request, without them signing in again."
            />

            {roles.isError ? (
              <QueryErrorAlert
                error={roles.error}
                subject="the role list"
                onRetry={() => {
                  void roles.refetch();
                }}
              />
            ) : null}

            {/* Wraps rather than scrolling at 360px, and the primary action
                comes after the picker so the reading order matches the doing
                order. */}
            <div className="flex flex-wrap items-center gap-2">
              <RecordPicker
                id="grant-role"
                value={granting}
                onValueChange={setGranting}
                options={assignable}
                label="Role to grant"
                placeholder={
                  roles.isPending
                    ? 'Loading roles'
                    : assignable.length === 0
                      ? 'Every role is already held'
                      : 'Choose a role'
                }
                searchPlaceholder="Search roles"
                emptyMessage="No role matches that."
                loading={roles.isPending}
                disabled={assignable.length === 0}
                icon={<ShieldCheckIcon />}
              />
              <Button
                disabled={granting === null || assign.isPending}
                onClick={() => {
                  assign.reset();
                  setConfirmGrant(true);
                }}
              >
                <ShieldCheckIcon data-icon="inline-start" />
                Grant
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ReasonDialog
        open={confirmGrant}
        onOpenChange={(next) => {
          if (!next) setConfirmGrant(false);
        }}
        title={`Grant ${granting?.label ?? 'this role'} to ${name}?`}
        description="A role change takes effect on the holder's very next request, without them signing in again."
        consequences={grantConsequences(grantedRole?.permissions.length ?? 0, name)}
        prompt="Why is this being granted?"
        hint="Six months from now this is the only record of why somebody gained an ability."
        confirmLabel="Grant role"
        pendingLabel="Granting"
        pending={assign.isPending}
        error={assign.error}
        onConfirm={submitGrant}
      />

      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
        title={`Remove ${revoking?.name ?? ''} from ${name}?`}
        description="Everything this role carries stops applying on their next request."
        consequences={revokeConsequences(revoking, name)}
        prompt="Why is this being removed?"
        hint="Stored against your name in the audit log."
        confirmLabel="Remove role"
        pendingLabel="Removing"
        confirmIcon={<REVOKE_ICON data-icon="inline-start" />}
        destructive
        pending={revoke.isPending}
        error={revoke.error}
        onConfirm={submitRevoke}
      />

      <EmployeeInviteDialog
        employee={manageCredentialsOpen ? employee : null}
        onOpenChange={setManageCredentialsOpen}
      />
    </section>
  );
}

const ACCOUNT_STATUS_LABELS: Record<'INVITED' | 'ACTIVE' | 'SUSPENDED', string> = {
  INVITED: 'Invited, not yet accepted',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
};

function grantConsequences(permissionCount: number, name: string): string[] {
  return [
    `${name} gains ${String(permissionCount)} permission${permissionCount === 1 ? '' : 's'}.`,
    'Every screen the role unlocks appears in their sidebar and their Go To palette at once.',
  ];
}

/**
 * Says what is about to be lost, and warns about the one refusal the server can
 * still make.
 *
 * The last-holder rule is enforced server-side inside a locking transaction and
 * this screen deliberately does not try to predict it -- a client that guessed
 * would be a second copy of the rule, and the copy is the one that drifts. It
 * warns, and lets the server answer.
 */
function revokeConsequences(role: AssignedRole | null, name: string): string[] {
  if (role === null) return [];

  const lines = [
    `${name} loses ${String(role.permissions.length)} permission${role.permissions.length === 1 ? '' : 's'}.`,
  ];

  if (role.permissions.includes(PERMISSIONS.ROLES_MANAGE)) {
    lines.push(
      'This role carries roles.manage. If this is the last account that holds it, the server ' +
        'will refuse — an organisation with nobody able to manage roles cannot get itself back.',
    );
  }

  return lines;
}

