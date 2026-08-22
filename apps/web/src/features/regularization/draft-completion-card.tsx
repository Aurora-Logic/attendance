import { useState } from 'react';
import { PaperPlaneTiltIcon, SparkleIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { TimeField } from '@/features/attendance/pickers';
import { formatClock } from '@/features/attendance/format';
import { formatDate } from '@/lib/format';
import type { RegularizationRequest } from '@vyuha/shared';

import { useCompleteRegularizationDraft } from './use-regularization';

/**
 * `attendance.regularization_auto_file`'s other half, on screen.
 *
 * The system already raised this — date, kind and a proposed time that
 * matches the punch as it stands — because the org turned the setting on so
 * an employee would not have to notice a late arrival and go raise a
 * correction from a blank form. What it could not supply is why, so this
 * card asks for exactly that and nothing else the employee has not already
 * been told: the time fields are here only because the draft's proposal
 * might be wrong (a slow device, not a genuinely late arrival), not because
 * anything is unset.
 */

interface DraftCompletionCardProps {
  readonly draft: RegularizationRequest;
}

export function DraftCompletionCard({ draft }: DraftCompletionCardProps) {
  const [requestedIn, setRequestedIn] = useState(formatClock(draft.requestedIn) || '00:00');
  const [requestedOut, setRequestedOut] = useState(formatClock(draft.requestedOut) || '00:00');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  const complete = useCompleteRegularizationDraft();

  const reasonError =
    attempted && reason.trim().length < 3 ? 'Say what happened, in a few words at least.' : undefined;
  const valid = reason.trim().length >= 3;

  function submit() {
    setAttempted(true);
    if (!valid) return;

    complete.mutate(
      {
        id: draft.id,
        input: {
          reason: reason.trim(),
          requestedIn: draft.requestedIn === null ? undefined : requestedIn,
          requestedOut: draft.requestedOut === null ? undefined : requestedOut,
        },
      },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: 'Correction sent',
            description: 'It is now waiting for your approver.',
          });
        },
        onError: (error) => {
          const copy = actionErrorCopy(error, 'Send the correction');
          toast.add({ type: 'error', title: copy.title, description: copy.description });
        },
      },
    );
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparkleIcon className="text-warning" />
          {formatDate(draft.date)} needs your input
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs">
          This punch was outside the shift window, so a correction was started for you. Add why,
          adjust the time if it is wrong, and send it to your approver.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {draft.requestedIn === null ? null : (
            <Field>
              <FieldLabel htmlFor={`draft-in-${draft.id}`}>Arrived</FieldLabel>
              <TimeField
                id={`draft-in-${draft.id}`}
                label="Arrival time"
                value={requestedIn}
                onValueChange={setRequestedIn}
                disabled={complete.isPending}
              />
            </Field>
          )}
          {draft.requestedOut === null ? null : (
            <Field>
              <FieldLabel htmlFor={`draft-out-${draft.id}`}>Left</FieldLabel>
              <TimeField
                id={`draft-out-${draft.id}`}
                label="Departure time"
                value={requestedOut}
                onValueChange={setRequestedOut}
                disabled={complete.isPending}
              />
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor={`draft-reason-${draft.id}`}>Why</FieldLabel>
          <Textarea
            id={`draft-reason-${draft.id}`}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            disabled={complete.isPending}
            placeholder="Traffic, a client call that ran over, a device that lagged behind — whatever it was."
            rows={2}
          />
          {reasonError ? <FieldError>{reasonError}</FieldError> : null}
        </Field>

        <Button
          className="self-start"
          disabled={complete.isPending}
          onClick={submit}
        >
          {complete.isPending ? <Spinner data-icon="inline-start" /> : <PaperPlaneTiltIcon data-icon="inline-start" />}
          Send to my approver
        </Button>
      </CardContent>
    </Card>
  );
}
