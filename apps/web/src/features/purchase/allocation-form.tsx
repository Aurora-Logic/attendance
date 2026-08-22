import { useState, type ReactNode } from 'react';
import { ScalesIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { SectionHeading } from '@/components/shared/section-heading';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { formatQty, type Grn } from './types';
import { useAllocateReceipt } from './use-purchase';

/**
 * REQ-X-27 / D-30: a receipt short of the requirements waiting on it is
 * shared out by a person, not by arrival order. One line of the PO at a
 * time: what came in unallocated, who is waiting and for how much, and a
 * box per waiting order. Nothing is prefilled — a suggested split is a
 * decision made for the reader, and the point of this screen is that the
 * decision is theirs and recorded.
 */

const QTY = /^\d{1,12}(\.\d{1,3})?$/u;

interface AllocationFormProps {
  /** Registers ctrl+a into whatever layer encloses it; the caller owns the layer. */
  grn: Grn;
  onAllocated?: (grn: Grn) => void;
  /** Rendered as the form's own footer; a dialog passes its own instead. */
  footer?: (controls: { submit: () => void; canSubmit: boolean; pending: boolean }) => ReactNode;
}

export function AllocationForm({ grn, onAllocated, footer }: AllocationFormProps) {
  const canApprove = usePermission(PERMISSIONS.PURCHASE_DOCUMENT_APPROVE);
  const allocate = useAllocateReceipt();
  const [values, setValues] = useState<Record<string, string>>({});

  const perLine = grn.pendingAllocations.map((pending) => {
    const entries = pending.waiting.map((w) => ({ waiting: w, value: values[w.requirementId] ?? '' }));
    const total = entries.reduce((sum, e) => sum + (e.value.trim() === '' ? 0 : Number(e.value)), 0);
    const bad = entries.some((e) => e.value.trim() !== '' && (!QTY.test(e.value.trim()) || Number(e.value) > Number(e.waiting.outstandingQty) + 1e-9));
    const over = total > Number(pending.unallocatedQty) + 1e-9;
    return { pending, entries, total, bad, over };
  });
  const anyValue = perLine.some((l) => l.total > 0);
  const invalid = perLine.some((l) => l.bad || l.over);
  const canSubmit = canApprove && anyValue && !invalid && !allocate.isPending;

  function submit() {
    if (!canSubmit) return;
    const allocations = perLine.flatMap((l) => l.entries.filter((e) => e.value.trim() !== '' && Number(e.value) > 0).map((e) => ({ requirementId: e.waiting.requirementId, quantity: e.value.trim() })));
    allocate.mutate(
      { grnId: grn.id, input: { allocations } },
      {
        onSuccess: (saved) => {
          setValues({});
          toast.add({
            type: 'success',
            title: `${saved.number} allocated`,
            description: saved.pendingAllocations.length === 0 ? 'Every waiting order has its share; the owners are told.' : `${String(saved.pendingAllocations.length)} line${saved.pendingAllocations.length === 1 ? '' : 's'} still wait for a decision.`,
          });
          onAllocated?.(saved);
        },
      },
    );
  }

  const copy = actionErrorCopy(allocate.error, 'Allocating the receipt');

  return (
    <>
      <SaveShortcut onSave={submit} />
      <div className="flex flex-col gap-4">
        {allocate.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        ) : null}
        {!canApprove ? <FieldDescription>Deciding who gets a short receipt needs purchase.document.approve (D-30). You can see what is waiting; a sales manager decides.</FieldDescription> : null}

        {perLine.map(({ pending, entries, total, over }) => (
          <section key={pending.purchaseOrderLineId} className="flex flex-col gap-2">
            <SectionHeading title={pending.stockItemName} note={`${formatQty(pending.unallocatedQty)} received and not yet given to anyone. ${String(pending.waiting.length)} order${pending.waiting.length === 1 ? ' waits' : 's wait'} on it.`} />
            <ul className="divide-y border">
              {entries.map(({ waiting, value }) => (
                <li key={waiting.requirementId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{waiting.salesOrderNumber ?? 'Stock'}</span>
                    {waiting.customerName ? <span className="text-muted-foreground ml-2 text-xs">{waiting.customerName}</span> : null}
                    <span className="text-muted-foreground ml-2 text-xs tabular-nums">needs {formatQty(waiting.outstandingQty)}</span>
                  </span>
                  <Input
                    aria-label={`Quantity for ${waiting.salesOrderNumber ?? 'stock'}`}
                    inputMode="decimal"
                    className="w-28 tabular-nums"
                    placeholder="0"
                    disabled={!canApprove}
                    aria-invalid={value.trim() !== '' && (!QTY.test(value.trim()) || Number(value) > Number(waiting.outstandingQty) + 1e-9) ? true : undefined}
                    value={value}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [waiting.requirementId]: event.target.value }));
                    }}
                  />
                </li>
              ))}
            </ul>
            <p className={over ? 'text-destructive text-xs tabular-nums' : 'text-muted-foreground text-xs tabular-nums'}>
              {over ? `${formatQty(String(total))} given, but only ${formatQty(pending.unallocatedQty)} came in.` : `${formatQty(String(total))} of ${formatQty(pending.unallocatedQty)} given.`}
            </p>
          </section>
        ))}

        {footer ? (
          footer({ submit, canSubmit, pending: allocate.isPending })
        ) : canApprove ? (
          <div className="flex justify-end">
            <Button disabled={!canSubmit} onClick={submit}>
              {allocate.isPending ? <Spinner data-icon="inline-start" /> : <ScalesIcon data-icon="inline-start" />}
              {allocate.isPending ? 'Allocating' : 'Allocate'}
              <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'allocation.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}

/**
 * The same form as a dialog, opened the moment a receipt comes back with
 * allocations pending. The caller holds the GRN; a partial allocation hands
 * the refreshed GRN back so what is left to decide stays accurate.
 */
export function AllocateDialog({ grn, onGrnChange }: { grn: Grn | null; onGrnChange: (grn: Grn | null) => void }) {
  return (
    <Dialog
      open={grn !== null}
      onOpenChange={(open) => {
        if (!open) onGrnChange(null);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {grn !== null ? (
          <ShortcutLayer id={`modal:allocate-${grn.id}`}>
            <DialogHeader>
              <DialogTitle>Who gets {grn.number}?</DialogTitle>
              <DialogDescription>Less came in than the waiting orders need. Decide who gets what; the rest keeps waiting for the next receipt.</DialogDescription>
            </DialogHeader>
            <AllocationForm
              key={grn.id}
              grn={grn}
              onAllocated={(saved) => {
                onGrnChange(saved.pendingAllocations.length === 0 ? null : saved);
              }}
              footer={({ submit, canSubmit, pending }) => (
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      onGrnChange(null);
                    }}
                  >
                    Later
                  </Button>
                  <Button className="flex-1 sm:flex-none" disabled={!canSubmit} onClick={submit}>
                    {pending ? <Spinner data-icon="inline-start" /> : <ScalesIcon data-icon="inline-start" />}
                    {pending ? 'Allocating' : 'Allocate'}
                    <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
                  </Button>
                </DialogFooter>
              )}
            />
          </ShortcutLayer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
