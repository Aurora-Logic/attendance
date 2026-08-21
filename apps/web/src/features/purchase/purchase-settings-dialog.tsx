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
import type { PurchaseSettings } from '@vyuha/shared';

import { usePurchaseSettings, useSavePurchaseSettings } from './use-purchase';

/**
 * The two purchasing thresholds (REQ-X-16, REQ-AA-15), set by an approver.
 * A dialog off the purchase orders page rather than a tab under Settings:
 * the person who owns the approval line is the purchase approver, not the
 * organisation administrator, and the number is read next to the orders it
 * decides.
 */

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/u;

export function PurchaseSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <PurchaseSettingsBody
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PurchaseSettingsBody({ onClose }: { onClose: () => void }) {
  const settings = usePurchaseSettings();
  const save = useSavePurchaseSettings();
  return (
    <ShortcutLayer id="modal:purchase-settings">
      <DialogHeader>
        <DialogTitle>Purchase settings</DialogTitle>
        <DialogDescription>Where approval starts, and how long packed goods may wait for an invoice.</DialogDescription>
      </DialogHeader>
      {settings.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading purchase settings" className="flex flex-col gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : null}
      {settings.isError ? (
        <QueryErrorAlert
          error={settings.error}
          subject="purchase settings"
          onRetry={() => {
            void settings.refetch();
          }}
        />
      ) : null}
      {settings.isSuccess ? <PurchaseSettingsForm key={JSON.stringify(settings.data)} saved={settings.data} save={save} onClose={onClose} /> : null}
    </ShortcutLayer>
  );
}

function PurchaseSettingsForm({ saved, save, onClose }: { saved: PurchaseSettings; save: ReturnType<typeof useSavePurchaseSettings>; onClose: () => void }) {
  const [threshold, setThreshold] = useState(saved.approvalThreshold ?? '');
  const [hours, setHours] = useState(String(saved.invoiceWaitingHours));

  const thresholdOk = threshold.trim() === '' || AMOUNT.test(threshold.trim());
  const hoursOk = /^\d{1,3}$/u.test(hours.trim()) && Number(hours) <= 720;
  const next: PurchaseSettings = { approvalThreshold: threshold.trim() === '' ? null : threshold.trim(), invoiceWaitingHours: hoursOk ? Number(hours.trim()) : saved.invoiceWaitingHours };
  const dirty = next.approvalThreshold !== saved.approvalThreshold || next.invoiceWaitingHours !== saved.invoiceWaitingHours;
  const canSubmit = dirty && thresholdOk && hoursOk && !save.isPending;

  function submit() {
    if (!canSubmit) return;
    save.mutate(next, {
      onSuccess: (result) => {
        toast.add({
          type: 'success',
          title: 'Purchase settings saved',
          description: result.approvalThreshold === null ? 'No PO needs approval by value.' : `POs at or above ${result.approvalThreshold} wait for approval.`,
        });
        onClose();
      },
    });
  }

  const copy = actionErrorCopy(save.error, 'Saving purchase settings');

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
            <FieldLabel htmlFor="purchase-threshold">Approval threshold</FieldLabel>
            <Input
              id="purchase-threshold"
              inputMode="decimal"
              className="pointer-coarse:h-11 tabular-nums"
              placeholder="None"
              aria-invalid={thresholdOk ? undefined : true}
              value={threshold}
              onChange={(event) => {
                setThreshold(event.target.value);
              }}
            />
            <FieldDescription>POs at or above this amount wait for approval in the inbox; leave empty for none.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="purchase-invoice-hours">Invoice waiting hours</FieldLabel>
            <Input
              id="purchase-invoice-hours"
              inputMode="numeric"
              className="pointer-coarse:h-11 tabular-nums"
              aria-invalid={hoursOk ? undefined : true}
              value={hours}
              onChange={(event) => {
                setHours(event.target.value);
              }}
            />
            <FieldDescription>Hours packed goods may wait for an invoice before accounts is told; 0 disables.</FieldDescription>
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
  useShortcut({ id: 'purchase-settings.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
