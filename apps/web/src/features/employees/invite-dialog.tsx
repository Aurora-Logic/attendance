import { useState } from 'react';
import {
  ArrowClockwiseIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { CopyField } from '@/components/shared/copy-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { ApiError } from '@/lib/api/client';
import {
  INVITATION_TTL_HOURS,
  PASSWORD_RESET_TTL_MINUTES,
  employeeDisplayName,
  type EmployeeListItem,
  type SignInAccount,
} from '@vyuha/shared';

import {
  useCreateInvitation,
  useIssuePasswordResetLink,
  useSignInAccount,
} from './use-sign-in-access';

/**
 * REQ-B-03: how somebody gets an account, on the record of the person who is
 * getting one.
 *
 * Until this existed there was no invite screen anywhere in the product — an
 * account could only be created by calling `POST /auth/invitations` by hand —
 * and the link it minted was only ever sent by email. With no mail server
 * configured that is nobody signing in, ever, which is why the endpoint now
 * returns the link and why this dialog exists to show it.
 *
 * The dialog reads `/employees/:id/access` before offering anything, because
 * what a person needs depends on what they already have, and the register's row
 * does not carry it:
 *
 *   * no account            — invite them
 *   * invited, not accepted — issue a fresh link; the previous one dies
 *   * active                — no second login (REQ-B-02 is 1:1). A password
 *                             reset link is the thing they actually want
 *   * suspended             — neither, until it is reactivated
 *
 * Every one of those refusals is also enforced server-side; this states the
 * reason before the press rather than after a 409.
 */

interface InviteDialogProps {
  employee: EmployeeListItem | null;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeInviteDialog({ employee, onOpenChange }: InviteDialogProps) {
  return (
    <Dialog open={employee !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remounted per person, so a link minted for one employee can never
            still be on screen while another one's record is open. */}
        {employee === null ? null : (
          <InviteBody
            key={employee.id}
            employee={employee}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "this link stops working on Sunday 17 August at 12:04".
 *
 * Long form, not the dd-MM-yyyy the tables use. This sentence is read once, by
 * somebody deciding whether it is worth sending now or in the morning, and
 * "17-08-2026" makes that arithmetic rather than reading. The time is included
 * because 72 hours does not land at midnight.
 */
function expiryInWords(iso: string): string {
  const at = parseISO(iso);
  if (Number.isNaN(at.getTime())) return 'shortly';
  return format(at, "EEEE d MMMM 'at' HH:mm");
}

function AccessSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Checking this employee's account">
      <Skeleton aria-hidden className="h-3 w-48" />
      <Skeleton aria-hidden className="mt-2 h-8 w-full" />
    </div>
  );
}

function InviteBody({ employee, onClose }: { employee: EmployeeListItem; onClose: () => void }) {
  const name = employeeDisplayName(employee.firstName, employee.lastName);
  const access = useSignInAccount(employee.id);
  const invite = useCreateInvitation();
  const reset = useIssuePasswordResetLink();

  // What the dialog is currently showing a link for. Held rather than read off
  // the mutation, so issuing a second invitation replaces the first link on
  // screen instead of leaving two.
  const [issued, setIssued] = useState<{ kind: 'invitation' | 'reset'; url: string; expiresAt: string } | null>(
    null,
  );

  const account = access.data?.account ?? null;
  const workEmail = employee.workEmail;

  function sendInvitation() {
    if (workEmail === null) return;
    invite.mutate(
      { employeeId: employee.id, email: workEmail },
      {
        onSuccess: (result) => {
          setIssued({ kind: 'invitation', url: result.acceptUrl, expiresAt: result.expiresAt });
          void access.refetch();
        },
      },
    );
  }

  function issueReset() {
    reset.mutate(
      { employeeId: employee.id },
      {
        onSuccess: (result) => {
          setIssued({ kind: 'reset', url: result.resetUrl, expiresAt: result.expiresAt });
        },
      },
    );
  }

  const pending = invite.isPending || reset.isPending;
  const failure = invite.error ?? reset.error;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{issued === null ? `Invite ${name} to sign in` : `Send this link to ${name}`}</DialogTitle>
        <DialogDescription>
          {issued === null
            ? 'An employee record and a login are separate things (REQ-B-02). This creates the login.'
            : 'Nothing was emailed. Copy the link and send it however you normally reach them.'}
        </DialogDescription>
      </DialogHeader>

      {access.isPending ? <AccessSkeleton /> : null}

      {access.isError ? (
        <QueryErrorAlert
          error={access.error}
          subject="this employee's account"
          onRetry={() => {
            void access.refetch();
          }}
        />
      ) : null}

      {issued !== null ? (
        <IssuedLink issued={issued} name={name} />
      ) : access.isSuccess ? (
        <Offer account={account} name={name} workEmail={workEmail} failure={failure} />
      ) : null}

      <DialogFooter className="flex-row justify-end gap-2">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          {issued === null ? 'Cancel' : 'Done'}
        </Button>

        {/* The primary action lives in the footer so it is nearest the thumb,
            and it changes verb with the state rather than appearing twice. */}
        {issued === null && access.isSuccess ? (
          <PrimaryAction
            account={account}
            workEmail={workEmail}
            pending={pending}
            onInvite={sendInvitation}
            onReset={issueReset}
          />
        ) : null}
        {issued !== null && issued.kind === 'invitation' ? (
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={sendInvitation}
          >
            {pending ? <Spinner data-icon="inline-start" /> : <ArrowClockwiseIcon data-icon="inline-start" />}
            {pending ? 'Issuing' : 'Issue a new link'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

type Account = SignInAccount['account'];

/**
 * What is about to happen, or the stated reason nothing can.
 *
 * No buttons here: the one action lives in the footer, nearest the thumb and
 * in the same place every other dialog in the product puts it. A second copy
 * beside the explanation would be two controls for one press.
 */
function Offer({
  account,
  name,
  workEmail,
  failure,
}: {
  account: Account;
  name: string;
  workEmail: string | null;
  failure: unknown;
}) {
  return (
    <div className="flex flex-col gap-3">
      {failure != null ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{failureCopy(failure).title}</AlertTitle>
          <AlertDescription>{failureCopy(failure).description}</AlertDescription>
        </Alert>
      ) : null}

      {workEmail === null ? (
        <Alert>
          <EnvelopeSimpleIcon />
          <AlertTitle>{name} has no work email</AlertTitle>
          <AlertDescription>
            Signing in is by work email (REQ-B-01), so there is nothing to create an account
            against. Add one to the employee record first.
          </AlertDescription>
        </Alert>
      ) : null}

      {account !== null && account.status === 'ACTIVE' ? (
        <Alert>
          <KeyIcon />
          <AlertTitle>{name} already has an account</AlertTitle>
          <AlertDescription>
            They sign in as {account.email}. An employee has one login and only one (REQ-B-02), so
            there is no second invitation to send. If they cannot get in, issue a password reset
            link instead — it lasts {PASSWORD_RESET_TTL_MINUTES} minutes and ends every session
            they have open.
          </AlertDescription>
        </Alert>
      ) : null}

      {account !== null && account.status === 'SUSPENDED' ? (
        <Alert>
          <WarningCircleIcon />
          <AlertTitle>{name}&rsquo;s account is suspended</AlertTitle>
          <AlertDescription>
            A suspended account cannot sign in, so neither an invitation nor a reset would let them
            in. Reactivate the account first; the server refuses both until then.
          </AlertDescription>
        </Alert>
      ) : null}

      {account !== null && account.status === 'INVITED' ? (
        <Alert>
          <PaperPlaneTiltIcon />
          <AlertTitle>{name} was invited but has not signed in yet</AlertTitle>
          <AlertDescription>
            Their invitation to {account.email} was never accepted, and its link may have expired.
            Issuing a new one gives you a link to hand over and stops the previous one working.
          </AlertDescription>
        </Alert>
      ) : null}

      {account === null && workEmail !== null ? (
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            A login is created for <span className="font-medium">{workEmail}</span>, dormant until
            they set a password.
          </li>
          <li>
            You get a link to pass on. It works once and stops working after{' '}
            {INVITATION_TTL_HOURS} hours.
          </li>
          <li>
            Nothing is emailed — the server has no mail transport configured, so this window is the
            only place the link appears.
          </li>
          <li>
            They can sign in but can do nothing until a role is granted, under Access and roles on
            their record (REQ-B-07).
          </li>
        </ul>
      ) : null}

    </div>
  );
}

function PrimaryAction({
  account,
  workEmail,
  pending,
  onInvite,
  onReset,
}: {
  account: Account;
  workEmail: string | null;
  pending: boolean;
  onInvite: () => void;
  onReset: () => void;
}) {
  if (account !== null && account.status === 'SUSPENDED') return null;

  if (account !== null && account.status === 'ACTIVE') {
    return (
      <Button className="flex-1 sm:flex-none" disabled={pending} onClick={onReset}>
        {pending ? <Spinner data-icon="inline-start" /> : <KeyIcon data-icon="inline-start" />}
        {pending ? 'Creating' : 'Reset password'}
      </Button>
    );
  }

  return (
    <Button
      className="flex-1 sm:flex-none"
      disabled={pending || workEmail === null}
      onClick={onInvite}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <PaperPlaneTiltIcon data-icon="inline-start" />}
      {pending ? 'Creating' : account === null ? 'Create invitation link' : 'Issue a new link'}
    </Button>
  );
}

/** The link, and everything the reader has to know while it is on screen. */
function IssuedLink({
  issued,
  name,
}: {
  issued: { kind: 'invitation' | 'reset'; url: string; expiresAt: string };
  name: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <CopyField
        id="issued-link"
        value={issued.url}
        label={issued.kind === 'invitation' ? 'Invitation link' : 'Password reset link'}
      />

      <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>
          This link stops working on{' '}
          <span className="text-foreground font-medium">{expiryInWords(issued.expiresAt)}</span>.
        </li>
        <li>
          It can be used once. Whoever opens it{' '}
          {issued.kind === 'invitation'
            ? `sets the password for ${name}'s account`
            : `chooses a new password for ${name}`}
          , so send it to them and to nobody else.
        </li>
        <li>
          {issued.kind === 'invitation'
            ? 'Issuing another link for this person immediately stops this one working.'
            : 'Using it signs them out of every device they are currently signed in on.'}
        </li>
      </ul>
    </div>
  );
}

/**
 * Maps the error code, never the message (technical design §6) — except where
 * the server is the only side that knows the specific refusal, which is every
 * conflict this dialog can provoke.
 */
function failureCopy(error: unknown): { title: string; description: string } {
  if (!(error instanceof ApiError)) {
    return { title: 'That did not go through', description: 'Something went wrong on the way.' };
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'No account was created. Check the connection and try again.',
      };
    case 'FORBIDDEN':
      return {
        title: 'The server refused this',
        description: 'Creating an account needs the employee.manage permission.',
      };
    case 'EMPLOYEE_ALREADY_LINKED':
    case 'CONFLICT':
      return { title: 'Refused', description: error.message };
    case 'NOT_FOUND':
      return {
        title: 'There is no account to reset',
        description: 'This employee has no login yet. Invite them instead.',
      };
    case 'VALIDATION_FAILED':
      return { title: 'The server would not accept that', description: error.message };
    default:
      return { title: 'That did not go through', description: error.message };
  }
}
