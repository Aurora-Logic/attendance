import { useState } from 'react';
import { PackageIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import { formatQty, lineBalance, type Grn, type PurchaseOrder } from './types';
import { useReceiveGrn } from './use-purchase';

/**
 * REQ-X-19…X-22: goods in against a confirmed PO. One box for received and
 * one for rejected per line still owed, a reason wherever anything is
 * rejected (REQ-X-21), the vendor's invoice reference for the accountant who
 * books the bill against the Receipt Note (REQ-X-22). Partial is normal
 * (REQ-X-20): a line left blank simply is not on this GRN.
 */

const QTY = /^\d{1,12}(\.\d{1,3})?$/u;

interface LineEntry {
  receivedQty: string;
  rejectedQty: string;
  rejectionReason: string;
}

interface GrnDialogProps {
  order: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the new GRN; the caller decides whether allocation follows (REQ-X-27). */
  onReceived: (grn: Grn) => void;
}

export function GrnDialog({ order, onOpenChange, onReceived }: GrnDialogProps) {
  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {order !== null ? (
          <GrnDialogBody
            key={order.id}
            order={order}
            onReceived={onReceived}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GrnDialogBody({ order, onReceived, onClose }: { order: PurchaseOrder; onReceived: (grn: Grn) => void; onClose: () => void }) {
  const receive = useReceiveGrn();
  const owed = order.lines.filter((line) => lineBalance(line) > 0);
  const [entries, setEntries] = useState<Record<string, LineEntry>>({});
  const [vendorInvoiceRef, setVendorInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');

  const entryOf = (id: string): LineEntry => entries[id] ?? { receivedQty: '', rejectedQty: '', rejectionReason: '' };
  const num = (v: string): number => (v.trim() === '' ? 0 : Number(v));

  const problems = owed.map((line) => {
    const e = entryOf(line.id);
    const balance = lineBalance(line);
    const badFormat = [e.receivedQty, e.rejectedQty].some((v) => v.trim() !== '' && !QTY.test(v.trim()));
    const over = num(e.receivedQty) + num(e.rejectedQty) > balance + 1e-9;
    const reasonMissing = num(e.rejectedQty) > 0 && e.rejectionReason.trim() === '';
    return { line, entry: e, balance, badFormat, over, reasonMissing, touched: num(e.receivedQty) + num(e.rejectedQty) > 0 };
  });
  const anyTouched = problems.some((p) => p.touched);
  const invalid = problems.some((p) => p.badFormat || p.over || p.reasonMissing);
  const canSubmit = anyTouched && !invalid && !receive.isPending;

  function submit() {
    if (!canSubmit) return;
    receive.mutate(
      {
        purchaseOrderId: order.id,
        input: {
          vendorInvoiceRef: vendorInvoiceRef.trim() === '' ? null : vendorInvoiceRef.trim(),
          notes: notes.trim() === '' ? null : notes.trim(),
          lines: problems
            .filter((p) => p.touched)
            .map((p) => ({
              purchaseOrderLineId: p.line.id,
              receivedQty: p.entry.receivedQty.trim() === '' ? '0' : p.entry.receivedQty.trim(),
              rejectedQty: p.entry.rejectedQty.trim() === '' ? '0' : p.entry.rejectedQty.trim(),
              rejectionReason: p.entry.rejectionReason.trim() === '' ? null : p.entry.rejectionReason.trim(),
            })),
        },
      },
      {
        onSuccess: (grn) => {
          toast.add({
            type: 'success',
            title: `${grn.number} recorded`,
            description: grn.syncState === 'QUEUED' ? 'Queued for Tally as a Receipt Note.' : grn.syncState === 'NOT_PUSHED' ? 'Nothing received into stock, or no agent connection can carry it yet.' : undefined,
          });
          onClose();
          onReceived(grn);
        },
      },
    );
  }

  const copy = actionErrorCopy(receive.error, 'Recording the receipt');

  return (
    <ShortcutLayer id={`modal:grn-${order.id}`}>
      <SaveShortcut onSave={submit} />
      <DialogHeader>
        <DialogTitle>Receive against {order.number}</DialogTitle>
        <DialogDescription>
          {order.vendorName}. Enter what arrived per line; anything rejected needs a reason and does not go into stock (REQ-X-21). Leave a line blank if none of it came.
        </DialogDescription>
      </DialogHeader>
      <Form onSubmit={submit} className="max-h-[60vh] overflow-y-auto">
        <FieldGroup>
          {receive.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description}</AlertDescription>
            </Alert>
          ) : null}

          <ol className="flex flex-col divide-y border">
            {problems.map(({ line, entry, balance, over, reasonMissing }, index) => (
              <li key={line.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium">
                    {String(line.lineNo)}. {line.description}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatQty(String(balance))} {line.unit ?? ''} still owed of {formatQty(line.quantity)}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
                  <Input
                    aria-label={`Line ${String(index + 1)} received quantity`}
                    inputMode="decimal"
                    className="pointer-coarse:h-11 tabular-nums"
                    placeholder="Received"
                    aria-invalid={over ? true : undefined}
                    value={entry.receivedQty}
                    onChange={(event) => {
                      setEntries((current) => ({ ...current, [line.id]: { ...entryOf(line.id), receivedQty: event.target.value } }));
                    }}
                  />
                  <Input
                    aria-label={`Line ${String(index + 1)} rejected quantity`}
                    inputMode="decimal"
                    className="pointer-coarse:h-11 tabular-nums"
                    placeholder="Rejected"
                    aria-invalid={over ? true : undefined}
                    value={entry.rejectedQty}
                    onChange={(event) => {
                      setEntries((current) => ({ ...current, [line.id]: { ...entryOf(line.id), rejectedQty: event.target.value } }));
                    }}
                  />
                  <Input
                    aria-label={`Line ${String(index + 1)} rejection reason`}
                    className="pointer-coarse:h-11"
                    placeholder="Reason for rejection"
                    disabled={num(entry.rejectedQty) <= 0}
                    aria-invalid={reasonMissing ? true : undefined}
                    value={entry.rejectionReason}
                    onChange={(event) => {
                      setEntries((current) => ({ ...current, [line.id]: { ...entryOf(line.id), rejectionReason: event.target.value } }));
                    }}
                  />
                </div>
                {over ? <FieldDescription className="text-destructive">More than is owed on this line.</FieldDescription> : null}
                {reasonMissing ? <FieldDescription className="text-destructive">A rejected quantity needs a reason.</FieldDescription> : null}
              </li>
            ))}
          </ol>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="grn-invoice-ref">Vendor invoice reference</FieldLabel>
              <Input
                id="grn-invoice-ref"
                className="pointer-coarse:h-11"
                maxLength={80}
                value={vendorInvoiceRef}
                onChange={(event) => {
                  setVendorInvoiceRef(event.target.value);
                }}
              />
              <FieldDescription>Carried into the Receipt Note narration for the accountant booking the bill (REQ-X-22).</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="grn-notes">Notes</FieldLabel>
              <Textarea
                id="grn-notes"
                rows={2}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </Field>
          </div>
        </FieldGroup>
      </Form>
      <DialogFooter className="flex-row justify-end gap-2">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={!canSubmit} onClick={submit}>
          {receive.isPending ? <Spinner data-icon="inline-start" /> : <PackageIcon data-icon="inline-start" />}
          {receive.isPending ? 'Recording' : 'Record receipt'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </DialogFooter>
    </ShortcutLayer>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'grn-dialog.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
