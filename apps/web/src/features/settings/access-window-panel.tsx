import { MoonIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TimeField } from '@/features/attendance/pickers';
import { formatClock } from '@/features/attendance/format';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { ApiError } from '@/lib/api/client';

import type { AccessWindowDraftState } from './use-access-window';

/**
 * 12 Area AB. Sign-in closes at one time and reopens at another, on the
 * organisation's clock, on the days chosen (REQ-AB-01, AB-02). Only a holder
 * of `access.outside_window` signs in or works between the two (REQ-AB-03);
 * the refusal names when it reopens (REQ-AB-04); punch is never refused
 * (REQ-AB-06). The Save is the screen's one Save, in the toolbar.
 */

/** Sunday first because the server counts 0 = Sunday; the labels follow it. */
const DAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 0, short: 'Sun', long: 'Sunday' },
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
];

function describeDays(days: readonly number[]): string {
  if (days.length === 0) return 'no day';
  if (days.length === 7) return 'every day';
  return DAYS.filter((d) => days.includes(d.value))
    .map((d) => d.long)
    .join(', ');
}

export function AccessWindowPanel({ window: state, saveError }: { window: AccessWindowDraftState; saveError: unknown }) {
  const { query, draft } = state;
  return (
    <div className="flex flex-col gap-4 border p-4">
      <SectionHeading title="Access window" note="When sign-in closes and reopens, on the organisation's clock. Punch is always allowed." />

      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading access window" className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} aria-hidden className="flex flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <QueryErrorAlert
          error={query.error}
          subject="access window"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {saveError != null ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{saveError instanceof ApiError && (saveError.code === 'NETWORK_ERROR' || saveError.status === 404) ? 'Not saved: the access window endpoint is not connected yet' : 'Could not save the access window'}</AlertTitle>
          <AlertDescription>{saveError instanceof ApiError && saveError.code === 'VALIDATION_FAILED' ? saveError.message : 'Your edits are still here. Nothing was sent to the server, so nothing changed.'}</AlertDescription>
        </Alert>
      ) : null}

      {draft !== null ? (
        <FieldGroup className="grid gap-5 md:grid-cols-2">
          <Field orientation="horizontal" className="md:col-span-2">
            <FieldLabel htmlFor="access-window-enabled">Refuse sign-in outside the window</FieldLabel>
            <Switch
              id="access-window-enabled"
              checked={draft.enabled}
              onCheckedChange={(next: boolean) => {
                state.edit({ enabled: next });
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="access-window-closes">Closes at</FieldLabel>
            <TimeField
              id="access-window-closes"
              label="Closes at"
              value={draft.closesAt}
              onValueChange={(next) => {
                state.edit({ closesAt: next });
              }}
            />
            <FieldDescription>Sign-in is refused from this time. Sessions already open run on until their token expires.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="access-window-reopens">Reopens at</FieldLabel>
            <TimeField
              id="access-window-reopens"
              label="Reopens at"
              value={draft.reopensAt}
              onValueChange={(next) => {
                state.edit({ reopensAt: next });
              }}
            />
            <FieldDescription>Named in the refusal, so nobody is told only "access denied". A reopen earlier than the close means overnight.</FieldDescription>
          </Field>

          <Field className="md:col-span-2">
            <FieldLabel>Applies on</FieldLabel>
            <ToggleGroup
              multiple
              variant="outline"
              aria-label="Days the window applies"
              value={draft.days.map(String)}
              onValueChange={(value) => {
                state.edit({ days: value.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b) });
              }}
              className="flex-wrap"
            >
              {DAYS.map((day) => (
                <ToggleGroupItem key={day.value} value={String(day.value)} aria-label={day.long} className="min-w-12">
                  {day.short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>Weekly-off days can be left out; no day chosen means the window never applies.</FieldDescription>
          </Field>

          <Alert className="md:col-span-2">
            <MoonIcon />
            <AlertTitle>{draft.enabled ? 'What this does' : 'Off: sign-in is open around the clock'}</AlertTitle>
            <AlertDescription>
              Between {formatClock(draft.closesAt)} and {formatClock(draft.reopensAt)} on {describeDays(draft.days)}, only accounts with access.outside_window may sign in or work; punch is always allowed. Every refused
              sign-in is audited.
            </AlertDescription>
          </Alert>
        </FieldGroup>
      ) : null}
    </div>
  );
}
