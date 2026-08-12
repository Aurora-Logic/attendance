import { useState } from 'react';
import { CheckIcon, ProhibitIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

/**
 * The one place an approval decision is confirmed.
 *
 * REQ-F-05 makes a reason mandatory on rejection — the requester is notified
 * with it, and "rejected" with no explanation is the thing that generates the
 * phone call this product exists to remove. Approval takes an optional note,
 * so both verbs share this dialog rather than each growing their own.
 *
 * A centred Dialog at every width, not a Sheet on a phone: a confirmation is
 * not anchored to anything, so it does not belong on an edge.
 */

interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'APPROVE' | 'REJECT';
  /** How many requests the decision covers. One for a row action. */
  count: number;
  /** What is being decided, in the reader's words. */
  subject: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}

export function DecisionDialog({ open, onOpenChange, ...rest }: DecisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so the reason field starts empty for every
            decision. An effect that cleared it on open would leave one render
            in which the previous rejection's note is still on screen — and
            that note belongs to somebody else's request. */}
        {open ? <DecisionForm onClose={() => { onOpenChange(false); }} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({
  action,
  count,
  subject,
  pending,
  onConfirm,
  onClose,
}: Omit<DecisionDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  const rejecting = action === 'REJECT';
  const missingReason = rejecting && reason.trim().length === 0;

  function confirm() {
    setAttempted(true);
    if (missingReason || pending) return;
    onConfirm(reason.trim());
  }

  const title = rejecting
    ? count === 1
      ? 'Reject this request'
      : `Reject ${String(count)} requests`
    : count === 1
      ? 'Approve this request'
      : `Approve ${String(count)} requests`;

  return (
    <ShortcutLayer id="modal:approval-decision">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{subject}</DialogDescription>
      </DialogHeader>

      <Form onSubmit={confirm} className="flex flex-col gap-4">
        <Field data-invalid={attempted && missingReason ? true : undefined}>
          <FieldLabel htmlFor="decision-reason">
            {rejecting ? 'Reason' : 'Note (optional)'}
          </FieldLabel>
          <Textarea
            id="decision-reason"
            value={reason}
            rows={3}
            maxLength={500}
            autoFocus
            aria-invalid={attempted && missingReason}
            placeholder={
              rejecting
                ? 'Say why, so the requester knows what to change.'
                : 'Anything the requester should know.'
            }
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <FieldDescription>
            {rejecting
              ? 'Sent to the requester with the rejection.'
              : 'Recorded in the approval history either way.'}
          </FieldDescription>
          {attempted && missingReason ? <FieldError>A rejection must say why.</FieldError> : null}
        </Field>

        {/* One row, not the stacked default: two short actions fit at 360px,
            and stacking reverses them so the primary lands furthest from the
            thumb. */}
        <DialogFooter className="flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={rejecting ? 'destructive' : 'default'}
            className="flex-1 sm:flex-none"
            disabled={pending}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : rejecting ? (
              <ProhibitIcon data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {rejecting ? 'Reject' : 'Approve'}
            <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
          </Button>
        </DialogFooter>

        <DialogShortcut onConfirm={confirm} />
      </Form>
    </ShortcutLayer>
  );
}

/**
 * Ctrl+A accepts, from inside the reason field as well (PRD §6.4 keeps that
 * key live in inputs). Registered from a child so it disappears with the
 * dialog rather than staying bound to a closed surface.
 */
function DialogShortcut({ onConfirm }: { onConfirm: () => void }) {
  useShortcut({
    id: 'approval-decision.accept',
    keys: 'ctrl+a',
    label: 'Accept',
    scope: 'modal',
    run: onConfirm,
  });
  return null;
}
