import { useState } from 'react';
import { ArrowsClockwiseIcon, BooksIcon, CheckIcon, PencilSimpleIcon, UploadSimpleIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { RecordPicker, type PickerOption } from '@/components/shared/record-picker';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useParties } from '@/features/masters/use-parties';
import { useStockItems } from '@/features/masters/use-stock-items';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatRelativeAge } from '@/lib/format';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS, SALES_DOCUMENT_STATUS_LABELS, SYNC_STATE_LABELS } from '@vyuha/shared';

import { DocumentLinesEditor, type StockItemOption } from './document-lines-editor';
import { formatMoney } from './money';
import type { Estimate, EstimateDraft } from './types';
import { useAlterSalesOrder, useSalesOrderAction, useSaveSalesOrder } from './use-estimates';

/**
 * One sales order (REQ-W-03) and its sync state, worn where it cannot be
 * missed (REQ-W-06): the header badge is the agent's last word — queued,
 * in Tally with the voucher number, or rejected with Tally's own sentence.
 * A draft is edited and confirmed; a confirmed order that is in Tally is
 * read-only until Alter (REQ-W-07), which re-pushes against the GUID.
 */

export function SyncStateBadge({ record }: { record: Pick<Estimate, 'syncState' | 'remoteVoucherNumber'> }) {
  const label = SYNC_STATE_LABELS[record.syncState];
  return (
    <Badge variant={record.syncState === 'PUSHED' ? 'default' : record.syncState === 'FAILED' ? 'destructive' : 'outline'}>
      {record.syncState === 'PUSHED' && record.remoteVoucherNumber ? `${label} · #${record.remoteVoucherNumber}` : label}
    </Badge>
  );
}

interface SalesOrderSheetProps {
  draft: EstimateDraft | null;
  record?: Estimate | null;
  onOpenChange: (open: boolean) => void;
}

export function SalesOrderSheet({ draft, record, onOpenChange }: SalesOrderSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={draft !== null} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-3xl max-md:max-h-[92vh]">
        {draft ? (
          <SalesOrderSheetBody
            key={draft.id ?? 'new'}
            initial={draft}
            record={record ?? null}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SalesOrderSheetBody({ initial, record, onClose }: { initial: EstimateDraft; record: Estimate | null; onClose: () => void }) {
  const [draft, setDraft] = useState<EstimateDraft>(initial);
  const [altering, setAltering] = useState(false);
  const save = useSaveSalesOrder();
  const alter = useAlterSalesOrder();
  const act = useSalesOrderAction();
  const canAlter = usePermission(PERMISSIONS.SALES_DOCUMENT_ALTER);
  const canSeeMasters = usePermission(PERMISSIONS.MASTERS_TALLY_VIEW);
  const parties = useParties({ page: 1 }, { enabled: canSeeMasters });
  const items = useStockItems({ page: 1 }, { enabled: canSeeMasters });
  const isNew = initial.id === undefined;
  const isDraft = draft.status === 'DRAFT';
  const editable = isDraft || altering;

  const partyOptions: PickerOption[] = (parties.data?.data ?? []).map((p) => ({ id: p.id, label: p.name, ...(p.gstin === null ? {} : { hint: p.gstin }) }));
  const itemOptions: StockItemOption[] = (items.data?.data ?? []).map((i) => ({
    id: i.id,
    label: i.name,
    hint: [i.unit, i.salePrice === null || i.salePrice === undefined ? null : `@ ${i.salePrice}`].filter((p): p is string => p !== null).join(' '),
    unit: i.unit,
    salePrice: i.salePrice ?? null,
    gstRate: i.gstRate,
  }));
  const partyMissing = draft.partyId === null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const busy = save.isPending || alter.isPending || act.isPending;

  function submit() {
    if (partyMissing || busy || !editable) return;
    if (altering) {
      alter.mutate(draft, {
        onSuccess: (saved) => {
          toast.add({ type: 'success', title: `${saved.number} altered`, description: 'Re-queued for Tally against the same voucher.' });
          onClose();
        },
      });
      return;
    }
    save.mutate(draft, {
      onSuccess: (saved) => {
        toast.add({ type: 'success', title: isNew ? `${saved.number} raised` : `${saved.number} saved`, description: `${saved.customerName} · ${formatMoney(saved.grandTotal)}` });
        onClose();
      },
    });
  }

  function run(action: 'confirm' | 'push' | 'cancel') {
    if (initial.id === undefined) return;
    act.mutate(
      { id: initial.id, action },
      {
        onSuccess: (saved) => {
          toast.add({
            type: 'success',
            title:
              action === 'cancel'
                ? `${saved.number} cancelled`
                : saved.syncState === 'QUEUED'
                  ? `${saved.number} queued for Tally`
                  : `${saved.number} confirmed`,
            description: action !== 'cancel' && saved.syncState === 'NOT_PUSHED' ? 'No agent connection can carry it yet; push it when one is issued.' : undefined,
          });
          onClose();
        },
      },
    );
  }

  const failure = save.error ?? alter.error ?? act.error;
  const copy = actionErrorCopy(failure, save.error ? 'Saving the order' : alter.error ? 'Altering the order' : 'Changing the order');

  return (
    <ShortcutLayer id={`modal:sales-order-${initial.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {isNew ? 'New sales order' : `Sales order ${initial.number ?? ''}`}
          {isNew ? null : <Badge variant="outline">{SALES_DOCUMENT_STATUS_LABELS[draft.status]}</Badge>}
          {record === null ? null : <SyncStateBadge record={record} />}
        </SheetTitle>
        <SheetDescription>
          {isNew
            ? 'Pushes to Tally as a Sales Order voucher once confirmed. The customer must be a Tally party.'
            : record?.syncState === 'PUSHED'
              ? `In Tally as voucher #${record.remoteVoucherNumber ?? '?'}${record.lastPushedAt ? `, ${formatRelativeAge(record.lastPushedAt)}` : ''}. Read-only except through Alter.`
              : record?.syncState === 'QUEUED'
                ? 'Queued: the agent will push it on its next poll and report back.'
                : isDraft
                  ? 'A draft: edit freely, then confirm to queue it for Tally.'
                  : `${SALES_DOCUMENT_STATUS_LABELS[draft.status]}.`}
        </SheetDescription>
      </SheetHeader>

      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failure ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description}</AlertDescription>
            </Alert>
          ) : null}

          {record?.syncState === 'FAILED' && record.lastError ? (
            <Alert variant="destructive">
              <XCircleIcon />
              <AlertTitle>Tally rejected it</AlertTitle>
              <AlertDescription>
                <p className="font-mono text-xs">{record.lastError}</p>
                <p className="mt-1">Tally&rsquo;s own words (REQ-T-01). Fix the cause there or here, then push again.</p>
              </AlertDescription>
            </Alert>
          ) : null}

          {record?.sourceDocumentId ? (
            <FieldDescription>
              Converted from{' '}
              <Link to={`/sales/estimates/${record.sourceDocumentId}`} className="underline-offset-4 hover:underline">
                its estimate
              </Link>
              .
            </FieldDescription>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="order-party">Tally party</FieldLabel>
              <RecordPicker
                id="order-party"
                label="Tally party"
                placeholder="Choose the party"
                searchPlaceholder="Search parties"
                emptyMessage="No party matches. A prospect must become a party in Tally first (REQ-U-03)."
                icon={<BooksIcon className="text-muted-foreground" />}
                options={partyOptions}
                loading={parties.isPending}
                disabled={!editable || !canSeeMasters}
                value={partyOptions.find((o) => o.id === draft.partyId) ?? null}
                onValueChange={(next) => {
                  setDraft((current) => ({ ...current, partyId: next?.id ?? null, customerName: next?.label ?? current.customerName }));
                }}
              />
            </Field>
            <Field>
              <FieldLabel>Date</FieldLabel>
              <DateField
                label="Order date"
                value={fromDateParam(draft.date)}
                onValueChange={(next) => {
                  if (isDraft) setDraft((current) => ({ ...current, date: toDateParam(next) }));
                }}
                yearsBack={1}
                yearsForward={1}
              />
            </Field>
          </div>

          <DocumentLinesEditor
            lines={draft.lines}
            onLinesChange={(next) => {
              setDraft((current) => ({ ...current, lines: next }));
            }}
            editable={editable}
            itemOptions={itemOptions}
            itemsLoading={items.isPending}
            canPickItems={canSeeMasters}
            partyId={draft.partyId}
            companyId={draft.companyId}
            saved={record}
            dirty={dirty}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="order-notes">Notes</FieldLabel>
              <Textarea id="order-notes" rows={3} disabled={!editable} value={draft.notes} onChange={(e) => { setDraft((c) => ({ ...c, notes: e.target.value })); }} />
              <FieldDescription>Carried into the voucher narration, with the idempotency key.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="order-terms">Terms</FieldLabel>
              <Textarea id="order-terms" rows={3} disabled={!editable} value={draft.terms} onChange={(e) => { setDraft((c) => ({ ...c, terms: e.target.value })); }} />
            </Field>
          </div>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t">
        {!isNew && isDraft ? (
          <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => { run('cancel'); }}>
            <XCircleIcon data-icon="inline-start" />
            Cancel order
          </Button>
        ) : null}
        {!isNew && isDraft && !dirty ? (
          <Button variant="outline" disabled={busy} onClick={() => { run('confirm'); }}>
            <CheckIcon data-icon="inline-start" />
            Confirm and push
          </Button>
        ) : null}
        {!isNew && draft.status === 'CONFIRMED' && (record?.syncState === 'NOT_PUSHED' || record?.syncState === 'FAILED') ? (
          <Button variant="outline" disabled={busy} onClick={() => { run('push'); }}>
            <UploadSimpleIcon data-icon="inline-start" />
            {record.syncState === 'FAILED' ? 'Push again' : 'Push to Tally'}
          </Button>
        ) : null}
        {!isNew && record?.syncState === 'PUSHED' && canAlter && !altering ? (
          <Button variant="outline" disabled={busy} onClick={() => { setAltering(true); }}>
            <PencilSimpleIcon data-icon="inline-start" />
            Alter
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          {editable ? 'Cancel' : 'Close'}
        </Button>
        {editable ? (
          <Button disabled={busy || partyMissing || (altering && !dirty)} onClick={submit}>
            {busy ? <Spinner data-icon="inline-start" /> : altering ? <ArrowsClockwiseIcon data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
            {altering ? 'Alter and re-push' : save.isPending ? 'Saving' : 'Save'}
            <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
          </Button>
        ) : null}
      </SheetFooter>
    </ShortcutLayer>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'sales-order-sheet.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
