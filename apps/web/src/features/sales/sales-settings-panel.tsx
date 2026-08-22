import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import type { SalesSettings } from '@vyuha/shared';

import { useSalesSettings, useSaveSalesSettings } from './use-estimates';

/**
 * The discount threshold (REQ-W-08), on the Settings screen's Sales tab
 * (owner, 22 Aug 2026: every module's settings in one place). Its own
 * endpoint and its own Save, because the line belongs to whoever holds
 * sales.discount.approve, who may not hold settings.manage at all.
 */

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/u;

export function SalesSettingsPanel() {
  const settings = useSalesSettings();
  const save = useSaveSalesSettings();
  return (
    <div className="flex flex-col gap-4 border p-4">
      <SectionHeading title="Sales" note="Where a discount stops being the salesperson\u2019s call." />
      {settings.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading sales settings" className="flex flex-col gap-3">
          <Skeleton className="h-9" />
        </div>
      ) : null}
      {settings.isError ? (
        <QueryErrorAlert
          error={settings.error}
          subject="sales settings"
          onRetry={() => {
            void settings.refetch();
          }}
        />
      ) : null}
      {settings.isSuccess ? <SalesSettingsForm key={JSON.stringify(settings.data)} saved={settings.data} save={save} /> : null}
    </div>
  );
}

function SalesSettingsForm({ saved, save }: { saved: SalesSettings; save: ReturnType<typeof useSaveSalesSettings> }) {
  const [pct, setPct] = useState(saved.discountApprovalPct === null ? '' : String(saved.discountApprovalPct));
  const trimmed = pct.trim();
  const pctOk = trimmed === '' || (PERCENT.test(trimmed) && Number(trimmed) <= 100);
  const next: SalesSettings = { discountApprovalPct: trimmed === '' ? null : Number(trimmed) };
  const dirty = next.discountApprovalPct !== saved.discountApprovalPct;
  const canSubmit = dirty && pctOk && !save.isPending;

  function submit() {
    if (!canSubmit) return;
    save.mutate(next, {
      onSuccess: (result) => {
        toast.add({
          type: 'success',
          title: 'Sales settings saved',
          description: result.discountApprovalPct === null ? 'No discount needs approval.' : `Discounts above ${String(result.discountApprovalPct)}% wait for a Sales manager.`,
        });
      },
    });
  }

  const copy = actionErrorCopy(save.error, 'Saving sales settings');

  return (
    <>
      <Form onSubmit={submit}>
        <FieldGroup>
          {save.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="sales-discount-pct">Discount approval threshold (%)</FieldLabel>
            <Input
              id="sales-discount-pct"
              inputMode="decimal"
              className="tabular-nums"
              placeholder="None"
              aria-invalid={pctOk ? undefined : true}
              value={pct}
              onChange={(event) => {
                setPct(event.target.value);
              }}
            />
            <FieldDescription>An order with a line discounted above this waits in the Approvals inbox for sales.discount.approve; leave empty for none.</FieldDescription>
          </Field>
        </FieldGroup>
      </Form>
      <div className="flex justify-end">
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
          {save.isPending ? 'Saving' : 'Save sales settings'}
        </Button>
      </div>
    </>
  );
}

