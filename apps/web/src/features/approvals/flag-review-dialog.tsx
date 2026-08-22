import { useState } from 'react';
import { HALF_DAY_PARTS, type HalfDayPart, type PunchFlagReviewAction } from '@vyuha/shared';

import { Form } from '@/components/shared/form';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ShortcutLayer } from '@/lib/keyboard/registry';

import { FLAG_REVIEW_COPY } from './flag-review-copy';

/**
 * Owner, 21 Aug 2026: what an admin does with a flagged punch. Four actions,
 * one dialog: the note is required where the employee will read it as a
 * verdict (keep, note) and optional where the flag simply goes away.
 */


const HALF_LABELS: Record<HalfDayPart, string> = { FIRST_HALF: 'First half worked', SECOND_HALF: 'Second half worked' };

interface FlagReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: PunchFlagReviewAction;
  subject: string;
  pending: boolean;
  onConfirm: (input: { note?: string; halfDayPart?: HalfDayPart }) => void;
}

export function FlagReviewDialog({ open, onOpenChange, ...rest }: FlagReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so nothing typed for one punch survives
            into the dialog for the next. */}
        {open ? <FlagReviewForm onClose={() => { onOpenChange(false); }} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const MIN_NOTE = 10;

function FlagReviewForm({
  action,
  subject,
  pending,
  onConfirm,
  onClose,
}: Omit<FlagReviewDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const copy = FLAG_REVIEW_COPY[action];
  const [note, setNote] = useState('');
  const [half, setHalf] = useState<HalfDayPart>('SECOND_HALF');
  const [attempted, setAttempted] = useState(false);
  const trimmed = note.trim();
  const noteShort = trimmed.length > 0 && trimmed.length < MIN_NOTE;
  const noteMissing = copy.noteRequired && trimmed.length === 0;
  const Icon = copy.icon;

  function confirm() {
    setAttempted(true);
    if (noteMissing || noteShort || pending) return;
    onConfirm({
      ...(trimmed.length === 0 ? {} : { note: trimmed }),
      ...(action === 'HALF_DAY' ? { halfDayPart: half } : {}),
    });
  }

  return (
    <ShortcutLayer id="modal:flag-review">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{subject}</DialogDescription>
      </DialogHeader>

      <Form onSubmit={confirm} className="flex flex-col gap-4">
        {action === 'HALF_DAY' ? (
          <Field>
            <FieldLabel htmlFor="flag-half">Which half counts</FieldLabel>
            <Select
              value={half}
              onValueChange={(next: string | null) => {
                if (next === 'FIRST_HALF' || next === 'SECOND_HALF') setHalf(next);
              }}
            >
              <SelectTrigger id="flag-half">
                <SelectValue>{(value: string) => HALF_LABELS[value as HalfDayPart]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HALF_DAY_PARTS.map((part) => (
                  <SelectItem key={part} value={part}>
                    {HALF_LABELS[part]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>The day is pinned to a half day with your note as the reason.</FieldDescription>
          </Field>
        ) : null}

        <Field data-invalid={attempted && (noteMissing || noteShort) ? true : undefined}>
          <FieldLabel htmlFor="flag-note">{copy.noteLabel}</FieldLabel>
          <Textarea
            id="flag-note"
            value={note}
            rows={3}
            maxLength={500}
            autoFocus
            aria-invalid={attempted && (noteMissing || noteShort)}
            placeholder="A sentence the employee would understand."
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <FieldDescription>Kept on the punch and in the audit log.</FieldDescription>
          {attempted && noteMissing ? <FieldError>A note is required for this action.</FieldError> : null}
          {attempted && noteShort ? <FieldError>At least {MIN_NOTE} characters.</FieldError> : null}
        </Field>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={action === 'KEEP' ? 'destructive' : 'default'} className="flex-1 sm:flex-none" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
            {copy.verb}
          </Button>
        </DialogFooter>
      </Form>
    </ShortcutLayer>
  );
}
