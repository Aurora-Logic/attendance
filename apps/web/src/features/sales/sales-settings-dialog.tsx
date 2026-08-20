import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import type { SalesSettings } from '@vyuha/shared';

import { useSalesSettings, useSaveSalesSettings } from './use-estimates';

/**
 * The discount threshold (REQ-W-08), set by a discount approver. Off the
 * sales orders page for the same reason the purchase thresholds sit off the
 * PO page: the Sales manager owns the line, and reads it beside the orders
 * it decides.
 */

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/u;

export function SalesSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <SalesSettingsBody
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SalesSettingsBody({ onClose }: { onClose: () => void }) {
  const settings = useSalesSettings();
  const save = useSaveSalesSettings();
  return (
    <ShortcutLayer id="modal:sales-settings">
      <DialogHeader>
        <DialogTitle>Sales settings</DialogTitle>
        <DialogDescription>Where a discount stops being the salesperson&rsquo;s call.</DialogDescription>
      </DialogHeader>
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
      {settings.isSuccess ? <SalesSettingsForm key={JSON.stringify(settings.data)} saved={settings.data} save={save} onClose={onClose} /> : null}
    </ShortcutLayer>
  );
}

function SalesSettingsForm({ saved, save, onClose }: { saved: SalesSettings; save: ReturnType<typeof useSaveSalesSettings>; onClose: () => void }) {
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
        onClose();
      },
    });
  }

  const copy = actionErrorCopy(save.error, 'Saving sales settings');

  return (
    <>
      <SaveShortcut onSave={submit} />
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
              className="pointer-coarse:h-11 tabular-nums"
              placeholder="None"
              aria-invalid={pctOk ? undefined : true}
              value={pct}
              onChange={(event) => {
                setPct(event.target.value);
              }}
            />
            <FieldDescription>An order with a line discounted above this waits in the Approvals inbox for sales.discount.approve (REQ-W-08); leave empty for none.</FieldDescription>
          </Field>
        </FieldGroup>
      </Form>
      <DialogFooter className="flex-row justify-end gap-2">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={!canSubmit} onClick={submit}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
          {save.isPending ? 'Saving' : 'Save'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </DialogFooter>
    </>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'sales-settings.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
