import { useState } from 'react';
import { CheckCircleIcon, CircleIcon, PackageIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import { ResponsiveDialog, ResponsiveDialogActions } from './responsive-dialog';
import { lineBalances, trimZeros, type Estimate, type PackRecord, type SalesLine } from './types';
import { usePackOrder } from './use-fulfilment';

/**
 * REQ-AA-06…AA-10: the pick list, worked on a phone by somebody holding a
 * box. Each line with a balance shows ordered, packed and what is left, and
 * a box for what went in; the boxes start full because most packs are the
 * whole list, and a short pack (REQ-AA-07) is a number typed down. A line
 * left at zero is not named in the request and stays untouched. Comments
 * per line and per pack (REQ-AA-08) travel on the pack record (REQ-AA-09).
 *
 * The client refuses more than the balance with the sentence the API would
 * use, so the picker learns the rule from the field rather than from a 400.
 * The Pack button is pinned in the footer, under the thumb (REQ-AA-10).
 */

const QUANTITY = /^\d{1,12}(\.\d{1,3})?$/u;

interface PackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the order is still loading (the pick queue opens by id). */
  order: Estimate | null;
  loading?: boolean;
  loadError?: unknown;
  onRetry?: () => void;
  onPacked?: (record: PackRecord) => void;
}

export function PackDialog({ open, onOpenChange, order, loading = false, loadError, onRetry, onPacked }: PackDialogProps) {
  const close = () => {
    onOpenChange(false);
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={order === null ? 'Pack' : `Pack ${order.number}`}
      description={order === null ? 'The pick list for this order.' : `${order.customerName}. Type what went in the box; the balance stays on the order and returns to the queue.`}
      className="sm:max-w-lg"
    >
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading the order" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : null}
      {loadError !== undefined && loadError !== null ? <QueryErrorAlert error={loadError} subject="that sales order" onRetry={onRetry ?? close} /> : null}
      {order === null ? (
        <ResponsiveDialogActions>
          <Button variant="outline" className="pointer-coarse:min-h-11" onClick={close}>
            <ACTION_ICONS.close data-icon="inline-start" />
            Close
          </Button>
        </ResponsiveDialogActions>
      ) : (
        <PackForm key={order.id} order={order} onClose={close} onPacked={onPacked} />
      )}
    </ResponsiveDialog>
  );
}

interface LineEntry {
  quantity: string;
  comment: string;
}

function PackForm({ order, onClose, onPacked }: { order: Estimate; onClose: () => void; onPacked?: (record: PackRecord) => void }) {
  const lines = order.lines.filter((line) => lineBalances(line).toPack > 0);
  const [entries, setEntries] = useState<Record<string, LineEntry>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, { quantity: trimZeros(lineBalances(line).toPack.toFixed(3)), comment: '' }])),
  );
  const [boxCount, setBoxCount] = useState('1');
  const [comment, setComment] = useState('');
  const pack = usePackOrder();

  const problems = lines.map((line) => problemFor(line, entries[line.id]?.quantity ?? ''));
  const named = lines.filter((line) => Number(entries[line.id]?.quantity ?? '0') > 0);
  // D-44: a line is fulfilled when what is typed is its whole balance.
  const isFulfilled = (line: SalesLine) => Math.abs(Number(entries[line.id]?.quantity ?? '0') - lineBalances(line).toPack) < 1e-9 && lineBalances(line).toPack > 0;
  const fulfilledCount = lines.filter(isFulfilled).length;
  function toggleFulfilled(line: SalesLine) {
    const entry = entries[line.id] ?? { quantity: '', comment: '' };
    const next = isFulfilled(line) ? '' : trimZeros(lineBalances(line).toPack.toFixed(3));
    setEntries((current) => ({ ...current, [line.id]: { ...entry, quantity: next } }));
  }
  const boxes = Number(boxCount);
  const boxesValid = Number.isInteger(boxes) && boxes >= 1 && boxes <= 999;
  const packable = order.status === 'CONFIRMED' && order.shortClosedAt === null;
  const canSubmit = packable && named.length > 0 && problems.every((p) => p === null) && boxesValid && !pack.isPending;

  function submit() {
    if (!canSubmit) return;
    pack.mutate(
      {
        documentId: order.id,
        input: {
          boxCount: boxes,
          comment: comment.trim() === '' ? null : comment.trim(),
          lines: named.map((line) => {
            const entry = entries[line.id];
            const lineComment = entry?.comment.trim() ?? '';
            return { lineId: line.id, quantity: (entry?.quantity ?? '0').trim(), comment: lineComment === '' ? null : lineComment };
          }),
        },
      },
      {
        onSuccess: (record) => {
          toast.add({
            type: 'success',
            title: `${order.number} packed`,
            description: `${String(record.lines.length)} line${record.lines.length === 1 ? '' : 's'} in ${String(record.boxCount)} box${record.boxCount === 1 ? '' : 'es'}.`,
          });
          onPacked?.(record);
          onClose();
        },
      },
    );
  }

  const copy = actionErrorCopy(pack.error, 'Packing');

  return (
    <ShortcutLayer id={`modal:pack-${order.id}`}>
      <PackShortcut onSave={submit} />
      <FieldGroup>
        {pack.error ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        ) : null}

        {packable ? null : (
          <Alert>
            <PackageIcon />
            <AlertTitle>{order.shortClosedAt === null ? 'Only a confirmed order is picked' : `${order.number} was short-closed`}</AlertTitle>
            <AlertDescription>{order.shortClosedAt === null ? 'Confirm it first, then pack.' : (order.shortCloseReason ?? 'Its balance was written off.')}</AlertDescription>
          </Alert>
        )}

        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">Everything on {order.number} is packed.</p>
        ) : (
          <ol className="flex flex-col divide-y border">
            {lines.map((line, index) => {
              const balance = lineBalances(line);
              const problem = problems[index] ?? null;
              const entry = entries[line.id] ?? { quantity: '', comment: '' };
              return (
                <li key={line.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="min-w-0 text-sm font-medium">
                        <span className="text-muted-foreground mr-2 text-xs tabular-nums">{String(line.lineNo)}.</span>
                        {line.description}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        Ordered {trimZeros(line.quantity)} · Packed {trimZeros(line.packedQty)} · Balance {trimZeros(balance.toPack.toFixed(3))}
                        {line.unit ? ` ${line.unit}` : ''}
                      </span>
                    </div>
                    {/* D-44: one tap says "this line is done" — the whole balance goes in the box; a partial is typed below. */}
                    <Button
                      type="button"
                      variant={isFulfilled(line) ? 'default' : 'outline'}
                      size="sm"
                      className="pointer-coarse:min-h-11 shrink-0"
                      aria-pressed={isFulfilled(line)}
                      aria-label={`Line ${String(line.lineNo)} fulfilled`}
                      disabled={!packable}
                      onClick={() => {
                        toggleFulfilled(line);
                      }}
                    >
                      {isFulfilled(line) ? <CheckCircleIcon data-icon="inline-start" weight="fill" /> : <CircleIcon data-icon="inline-start" />}
                      Fulfilled
                    </Button>
                  </div>
                  <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2">
                    <Input
                      aria-label={`Line ${String(line.lineNo)} packed quantity`}
                      aria-invalid={problem !== null || undefined}
                      inputMode="decimal"
                      className="pointer-coarse:h-11 tabular-nums"
                      placeholder="Qty"
                      disabled={!packable}
                      value={entry.quantity}
                      onChange={(event) => {
                        setEntries((current) => ({ ...current, [line.id]: { ...entry, quantity: event.target.value } }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          submit();
                        }
                      }}
                    />
                    <Input
                      aria-label={`Line ${String(line.lineNo)} comment`}
                      className="pointer-coarse:h-11"
                      placeholder="Comment: short supply, damage, substitution"
                      disabled={!packable}
                      value={entry.comment}
                      onChange={(event) => {
                        setEntries((current) => ({ ...current, [line.id]: { ...entry, comment: event.target.value } }));
                      }}
                    />
                  </div>
                  {problem === null ? null : <FieldError>{problem}</FieldError>}
                </li>
              );
            })}
          </ol>
        )}

        {packable && lines.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
            <Field>
              <FieldLabel htmlFor="pack-boxes">Boxes</FieldLabel>
              <Input
                id="pack-boxes"
                inputMode="numeric"
                className="pointer-coarse:h-11 tabular-nums"
                aria-invalid={!boxesValid || undefined}
                value={boxCount}
                onChange={(event) => {
                  setBoxCount(event.target.value);
                }}
              />
              {boxesValid ? null : <FieldError>A whole number from 1 to 999.</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="pack-comment">Comment on this pack</FieldLabel>
              <Textarea
                id="pack-comment"
                rows={2}
                placeholder="Anything the office needs to know"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                }}
              />
              <FieldDescription>Visible to sales, on the order (REQ-AA-08).</FieldDescription>
            </Field>
          </div>
        ) : null}
      </FieldGroup>

      <ResponsiveDialogActions>
        <Button variant="outline" className="pointer-coarse:min-h-11" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          {packable && lines.length > 0 ? 'Cancel' : 'Close'}
        </Button>
        {packable && lines.length > 0 ? (
          <Button className="pointer-coarse:min-h-11" disabled={!canSubmit} onClick={submit}>
            {pack.isPending ? <Spinner data-icon="inline-start" /> : <PackageIcon data-icon="inline-start" />}
            {pack.isPending
              ? 'Packing'
              : named.length === 0
                ? 'Pack'
                : fulfilledCount === lines.length
                  ? `Pack all ${String(lines.length)}`
                  : `Pack ${String(named.length)} line${named.length === 1 ? '' : 's'}${fulfilledCount > 0 ? ` (${String(fulfilledCount)} fulfilled)` : ''}`}
            <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
          </Button>
        ) : null}
      </ResponsiveDialogActions>
    </ShortcutLayer>
  );
}

/** The API's own sentence, so the field teaches the same rule the server enforces. */
function problemFor(line: SalesLine, quantity: string): string | null {
  const trimmed = quantity.trim();
  if (trimmed === '' || Number(trimmed) === 0) return null;
  if (!QUANTITY.test(trimmed)) return 'A quantity with up to three decimals.';
  const balance = lineBalances(line).toPack;
  if (Number(trimmed) > balance + 1e-9) return `Line ${String(line.lineNo)} (${line.description}) has ${balance.toFixed(3)} left to pack, not ${trimmed}.`;
  return null;
}

function PackShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'pack-dialog.save', keys: 'ctrl+a', label: 'Accept / Pack', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
