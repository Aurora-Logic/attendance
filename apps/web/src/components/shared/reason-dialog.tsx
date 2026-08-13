import { useId, useState, type ReactNode } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import { MAX_ADMIN_REASON, MIN_ADMIN_REASON } from '@vyuha/shared';

/**
 * The confirm step for every destructive or overriding action (REQ-B-09a).
 *
 * One component, because the reason is the point of the whole slice and six
 * screens each writing their own textarea is six chances for one of them to
 * make it optional. The floor comes from `@vyuha/shared`, the same constant the
 * server's Zod schema and the `deletion_records` CHECK use — so the button can
 * only be pressed when the request will be accepted, and the user learns the
 * rule while typing rather than from a 400.
 *
 * The consequences go above the field, not below it. Somebody who reads only
 * the title and then looks for the input should have passed the warning on the
 * way; the reverse layout puts it where the eye has already left.
 */

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line saying what will happen. */
  description: string;
  /** What the reader must know before pressing. Rendered as a list. */
  consequences?: readonly string[];
  /** The label above the textarea; phrase it as a question. */
  prompt?: string;
  /** Why the reason is kept, in one line under the field. */
  hint?: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmIcon?: ReactNode;
  destructive?: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
}

export function ReasonDialog(props: ReasonDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted whenever the dialog opens, so a reason typed for one record
            can never be submitted against the next one somebody opens. */}
        {props.open ? <ReasonDialogBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialogBody({
  title,
  description,
  consequences,
  prompt = 'Why are you doing this?',
  hint,
  confirmLabel,
  pendingLabel,
  confirmIcon,
  destructive = false,
  pending,
  error,
  onConfirm,
  onOpenChange,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const fieldId = useId();

  const trimmed = reason.trim();
  const remaining = MIN_ADMIN_REASON - trimmed.length;
  const tooShort = remaining > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {consequences && consequences.length > 0 ? (
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {error != null ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{failureCopy(error).title}</AlertTitle>
          <AlertDescription>{failureCopy(error).description}</AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <FieldLabel htmlFor={fieldId}>{prompt}</FieldLabel>
        <Textarea
          id={fieldId}
          rows={3}
          maxLength={MAX_ADMIN_REASON}
          value={reason}
          autoFocus
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <FieldDescription>
          {/* A live count rather than a rule stated once at the top. The
              question a half-typed field raises is "is this enough yet", and a
              static "at least 10 characters" does not answer it. */}
          {tooShort
            ? `${String(remaining)} more character${remaining === 1 ? '' : 's'} needed. ${hint ?? ''}`
            : (hint ?? 'This is recorded against your name in the audit log.')}
        </FieldDescription>
      </Field>

      {/* Two short actions fit one row at 360px, so they stay in one row rather
          than stacking and putting the confirm furthest from the thumb. */}
      <DialogFooter className="flex-row justify-end gap-2">
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          className="flex-1 sm:flex-none"
          disabled={tooShort || pending}
          onClick={() => {
            onConfirm(trimmed);
          }}
        >
          {pending ? <Spinner data-icon="inline-start" /> : confirmIcon}
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Maps the error *code*, never the message (technical design §6).
 *
 * `RECORD_IN_USE` deliberately shows the server's message rather than a fixed
 * line: the server is the only side that knows which rows are in the way, and
 * naming them is the difference between a refusal and an instruction.
 */
function failureCopy(error: unknown): { title: string; description: string } {
  if (!(error instanceof ApiError)) {
    return { title: 'That did not go through', description: 'Something went wrong on the way.' };
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the server',
        description: 'Nothing was changed. Check the connection and try again.',
      };
    case 'NOT_FOUND':
      return {
        title: 'That record is no longer there',
        description: 'Somebody may have removed it. Reload the list and look again.',
      };
    case 'FORBIDDEN':
      return {
        title: 'The server refused this',
        description: 'It needs a permission your account does not hold.',
      };
    case 'RECORD_IN_USE':
    case 'SYSTEM_ROLE_PROTECTED':
    case 'LAST_ROLES_MANAGE_HOLDER':
    case 'RECORD_NOT_DELETED':
    case 'PERIOD_LOCKED':
    case 'PERIOD_ALREADY_LOCKED':
    case 'PERIOD_NOT_LOCKED':
    case 'CONFLICT':
      return { title: 'Refused', description: error.message };
    case 'VALIDATION_FAILED':
      return { title: 'The server would not accept that', description: error.message };
    default:
      return { title: 'That did not go through', description: error.message };
  }
}
