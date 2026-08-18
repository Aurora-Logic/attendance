import { useState } from 'react';
import { ArrowsClockwiseIcon, BooksIcon, CheckIcon, LockKeyOpenIcon, PackageIcon, PencilSimpleIcon, ProhibitIcon, ReceiptIcon, TruckIcon, UploadSimpleIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { RecordPicker, type PickerOption } from '@/components/shared/record-picker';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useParties } from '@/features/masters/use-parties';
import { useStockItems } from '@/features/masters/use-stock-items';
import { useIsMobile } from '@/hooks/use-mobile';
import { ApiError } from '@/lib/api/client';
import { EMPTY_VALUE, formatDate, formatRelativeAge } from '@/lib/format';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { DISPATCH_MODE_LABELS, PERMISSIONS, SALES_DOCUMENT_STATUS_LABELS, SYNC_STATE_LABELS } from '@vyuha/shared';

import { DispatchDialog } from './dispatch-dialog';
import { DocumentLinesEditor, type StockItemOption } from './document-lines-editor';
import { FulfilmentBadge } from './fulfilment-badge';
import { InvoiceDialog } from './invoice-dialog';
import { formatMoney } from './money';
import { PackDialog } from './pack-dialog';
import { ORDER_INVOICE_METHOD_LABELS, WAITING_ON_STATE_LABELS, creditBlockSchema, lineBalances, trimZeros, type CreditBlock, type Estimate, type EstimateDraft, type SalesLine } from './types';
import { useAlterSalesOrder, useSalesOrderAction, useSaveSalesOrder } from './use-estimates';
import { useDispatches } from './use-dispatches';
import { usePackRecords, useShortCloseOrder } from './use-fulfilment';

/**
 * One sales order (REQ-W-03) and its sync state, worn where it cannot be
 * missed (REQ-W-06): the header badge is the agent's last word — queued,
 * in Tally with the voucher number, or rejected with Tally's own sentence.
 * A draft is edited and confirmed; a confirmed order that is in Tally is
 * read-only until Alter (REQ-W-07), which re-pushes against the GUID.
 *
 * Once confirmed the order is fulfilled from here (12 §3): the numbers per
 * line (REQ-AA-29), the invoices against it (REQ-AA-12), the pack records
 * with their comments (REQ-AA-08), and the footer's Pack, Raise invoice,
 * Dispatch and Short close, each shown only when it means something.
 */

export function SyncStateBadge({ record }: { record: Pick<Estimate, 'syncState' | 'remoteVoucherNumber'> }) {
  const label = SYNC_STATE_LABELS[record.syncState];
  return (
    <Badge variant={record.syncState === 'PUSHED' ? 'default' : record.syncState === 'FAILED' ? 'destructive' : 'outline'}>
      {record.syncState === 'PUSHED' && record.remoteVoucherNumber ? `${label} · #${record.remoteVoucherNumber}` : label}
    </Badge>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** REQ-AA-29: the numbers per line, not a status word. */
const QUANTITY_COLUMNS: RecordColumn<SalesLine>[] = [
  {
    key: 'line',
    header: 'Line',
    cell: (line) => (
      <>
        <span className="text-muted-foreground mr-1 tabular-nums">{String(line.lineNo)}.</span>
        {line.description}
      </>
    ),
    className: 'max-w-[14rem] truncate',
  },
  { key: 'ordered', header: 'Ordered', cell: (line) => trimZeros(line.quantity), numeric: true },
  { key: 'packed', header: 'Packed', cell: (line) => trimZeros(line.packedQty), numeric: true },
  { key: 'invoiced', header: 'Invoiced', cell: (line) => trimZeros(line.invoicedQty), numeric: true },
  { key: 'dispatched', header: 'Dispatched', cell: (line) => trimZeros(line.dispatchedQty), numeric: true },
  {
    key: 'toPack',
    header: 'To pack',
    cell: (line) => {
      const toPack = lineBalances(line).toPack;
      return toPack > 0 ? <span className="font-medium">{trimZeros(toPack.toFixed(3))}</span> : EMPTY_VALUE;
    },
    numeric: true,
  },
];

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
  const [dialog, setDialog] = useState<'pack' | 'invoice' | 'dispatch' | 'short-close' | 'credit-override' | null>(null);
  const save = useSaveSalesOrder();
  const alter = useAlterSalesOrder();
  const act = useSalesOrderAction();
  const shortClose = useShortCloseOrder();
  const canAlter = usePermission(PERMISSIONS.SALES_DOCUMENT_ALTER);
  const canCreate = usePermission(PERMISSIONS.SALES_DOCUMENT_CREATE);
  const canOverrideCredit = usePermission(PERMISSIONS.SALES_CREDIT_OVERRIDE);
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

  // 12 §3: fulfilment starts once confirmed and ends when everything has
  // left or the balance is written off. Each action is offered only while
  // there is a quantity for it to move (REQ-AA-01).
  const confirmed = record !== null && record.status === 'CONFIRMED';
  const fulfilling = confirmed && record.shortClosedAt === null;
  const balances = record === null ? [] : record.lines.map(lineBalances);
  const canPack = canCreate && fulfilling && balances.some((b) => b.toPack > 0);
  const canInvoice = canCreate && confirmed && record.partyId !== null && balances.some((b) => b.toInvoice > 0);
  const canDispatch = canCreate && fulfilling && balances.some((b) => b.toDispatch > 0);
  const canShortClose = canAlter && fulfilling && record.fulfilment !== 'closed';
  const packs = usePackRecords(confirmed ? record.id : null);
  // REQ-AA-31: every dispatch against it, in one place; 50 is more than any order sees.
  const dispatches = useDispatches({ page: 1, pageSize: 50, ...(confirmed ? { documentId: record.id } : {}) }, { enabled: confirmed });

  // REQ-AA-28: the schema's own limits, so the box refuses what the API would.
  const emailProblem = draft.customerEmail.trim() !== '' && !EMAIL.test(draft.customerEmail.trim()) ? 'Not an email address.' : null;
  const whatsappProblem = draft.customerWhatsapp.trim() !== '' && (draft.customerWhatsapp.trim().length < 6 || draft.customerWhatsapp.trim().length > 24) ? 'A WhatsApp number is 6 to 24 characters.' : null;
  const contactInvalid = emailProblem !== null || whatsappProblem !== null;

  function submit() {
    if (partyMissing || busy || !editable || contactInvalid) return;
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

  function run(action: 'confirm' | 'push' | 'cancel', creditOverrideReason?: string) {
    if (initial.id === undefined) return;
    act.mutate(
      { id: initial.id, action, ...(creditOverrideReason === undefined ? {} : { body: { creditOverrideReason } }) },
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
        // A refused override lands back on the alert under the dialog, which is where the position is explained.
        onError: () => {
          if (creditOverrideReason !== undefined) setDialog(null);
        },
      },
    );
  }

  // REQ-W-09: a credit block is a refusal with a position, not a failure.
  const creditBlock = creditBlockOf(act.error);
  const failure = save.error ?? alter.error ?? (creditBlock === null ? act.error : null);
  const copy = actionErrorCopy(failure, save.error ? 'Saving the order' : alter.error ? 'Altering the order' : 'Changing the order');

  return (
    <ShortcutLayer id={`modal:sales-order-${initial.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {isNew ? 'New sales order' : `Sales order ${initial.number ?? ''}`}
          {isNew ? null : <Badge variant="outline">{SALES_DOCUMENT_STATUS_LABELS[draft.status]}</Badge>}
          {record === null ? null : <SyncStateBadge record={record} />}
          {record?.fulfilment && confirmed ? <FulfilmentBadge state={record.fulfilment} /> : null}
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

          {creditBlock !== null ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{creditBlock.position.partyName} is over its credit limit</AlertTitle>
              <AlertDescription>
                <p className="tabular-nums">
                  Exposure {formatMoney(creditBlock.position.exposure)} + open orders {formatMoney(creditBlock.position.openOrders)} + this order {formatMoney(creditBlock.orderTotal)} &gt; limit{' '}
                  {formatMoney(creditBlock.position.creditLimit)}
                  {creditBlock.position.creditDays === null ? '' : ` (${String(creditBlock.position.creditDays)} days)`}.
                </p>
                <p className="mt-1">
                  {canOverrideCredit ? 'You hold sales.credit.override: release it with a reason, which is audited (REQ-W-09).' : `Releasing it needs ${creditBlock.requiredPermission}; ask a holder to confirm it with a reason.`}
                </p>
              </AlertDescription>
              {canOverrideCredit ? (
                <AlertAction>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { setDialog('credit-override'); }}>
                    <LockKeyOpenIcon data-icon="inline-start" />
                    Release with reason
                  </Button>
                </AlertAction>
              ) : null}
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

          {confirmed ? <FulfilmentSections record={record} packs={packs} dispatches={dispatches} /> : null}

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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="order-customer-email">Customer email</FieldLabel>
              <Input
                id="order-customer-email"
                inputMode="email"
                className="pointer-coarse:h-11"
                aria-invalid={emailProblem !== null || undefined}
                disabled={!isDraft}
                placeholder={isNew ? 'From the party master when blank' : undefined}
                value={draft.customerEmail}
                onChange={(e) => { setDraft((c) => ({ ...c, customerEmail: e.target.value })); }}
              />
              {emailProblem === null ? <FieldDescription>Where dispatch notifications go; the party master&rsquo;s by default (REQ-AA-28).</FieldDescription> : <FieldError>{emailProblem}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="order-customer-whatsapp">Customer WhatsApp</FieldLabel>
              <Input
                id="order-customer-whatsapp"
                inputMode="tel"
                className="pointer-coarse:h-11"
                aria-invalid={whatsappProblem !== null || undefined}
                disabled={!isDraft}
                placeholder={isNew ? 'From the party master when blank' : undefined}
                value={draft.customerWhatsapp}
                onChange={(e) => { setDraft((c) => ({ ...c, customerWhatsapp: e.target.value })); }}
              />
              {whatsappProblem === null ? null : <FieldError>{whatsappProblem}</FieldError>}
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
        {canShortClose && !altering ? (
          <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => { setDialog('short-close'); }}>
            <ProhibitIcon data-icon="inline-start" />
            Short close
          </Button>
        ) : null}
        {canPack && !altering ? (
          <Button variant="outline" disabled={busy} onClick={() => { setDialog('pack'); }}>
            <PackageIcon data-icon="inline-start" />
            Pack
          </Button>
        ) : null}
        {canInvoice && !altering ? (
          <Button variant="outline" disabled={busy} onClick={() => { setDialog('invoice'); }}>
            <ReceiptIcon data-icon="inline-start" />
            Raise invoice
          </Button>
        ) : null}
        {canDispatch && !altering ? (
          <Button variant="outline" disabled={busy} onClick={() => { setDialog('dispatch'); }}>
            <TruckIcon data-icon="inline-start" />
            Dispatch
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          {editable ? 'Cancel' : 'Close'}
        </Button>
        {editable ? (
          <Button disabled={busy || partyMissing || contactInvalid || (altering && !dirty)} onClick={submit}>
            {busy ? <Spinner data-icon="inline-start" /> : altering ? <ArrowsClockwiseIcon data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
            {altering ? 'Alter and re-push' : save.isPending ? 'Saving' : 'Save'}
            <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
          </Button>
        ) : null}
      </SheetFooter>

      <ReasonDialog
        open={dialog === 'credit-override'}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        title={`Release ${initial.number ?? 'this order'} past the credit limit?`}
        description="The order confirms and queues for Tally although the party is over its limit. The position and your reason are recorded (REQ-W-09)."
        consequences={
          creditBlock === null
            ? []
            : [`${creditBlock.position.partyName}: exposure ${formatMoney(creditBlock.position.exposure)}, open orders ${formatMoney(creditBlock.position.openOrders)}, limit ${formatMoney(creditBlock.position.creditLimit)}.`, `This order adds ${formatMoney(creditBlock.orderTotal)}.`]
        }
        prompt="Why is this order being released?"
        hint="Kept in the audit log against your name."
        confirmLabel="Release and confirm"
        pendingLabel="Confirming"
        confirmIcon={<LockKeyOpenIcon data-icon="inline-start" />}
        pending={act.isPending}
        error={null}
        onConfirm={(reason) => {
          run('confirm', reason);
        }}
      />

      {record === null ? null : (
        <>
          <PackDialog open={dialog === 'pack'} onOpenChange={(next) => { if (!next) setDialog(null); }} order={record} />
          <InvoiceDialog open={dialog === 'invoice'} onOpenChange={(next) => { if (!next) setDialog(null); }} order={record} />
          <DispatchDialog open={dialog === 'dispatch'} onOpenChange={(next) => { if (!next) setDialog(null); }} order={record} />
          <ReasonDialog
            open={dialog === 'short-close'}
            onOpenChange={(next) => {
              if (!next) {
                setDialog(null);
                shortClose.reset();
              }
            }}
            title={`Short-close ${record.number}?`}
            description="The balance that has not left is written off (REQ-AA-05). It comes off the pick queue and its shortage requirements close."
            consequences={[
              'What is packed, invoiced or dispatched stays as it is.',
              'The order no longer returns to the pick queue.',
              'Recorded against your name in the audit log; it cannot be undone from here.',
            ]}
            prompt="Why is the balance being written off?"
            hint="The customer cancelled the rest, the item is discontinued — the reason is kept on the order."
            confirmLabel="Short close"
            pendingLabel="Closing"
            confirmIcon={<ProhibitIcon data-icon="inline-start" />}
            destructive
            pending={shortClose.isPending}
            error={shortClose.error}
            onConfirm={(reason) => {
              shortClose.mutate(
                { documentId: record.id, reason },
                {
                  onSuccess: (saved) => {
                    toast.add({ type: 'success', title: `${saved.number} short-closed`, description: 'The balance is written off; the order is closed.' });
                    setDialog(null);
                  },
                },
              );
            }}
          />
        </>
      )}
    </ShortcutLayer>
  );
}

/** The CREDIT_BLOCKED refusal's position, parsed rather than cast; a shape that moved renders the plain error instead. */
function creditBlockOf(error: unknown): CreditBlock | null {
  if (!(error instanceof ApiError) || error.code !== 'CREDIT_BLOCKED') return null;
  const parsed = creditBlockSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/**
 * REQ-AA-29: the numbers, not a status word — ordered, packed, invoiced,
 * dispatched and the balance to pack, per line. Then the invoices against
 * the order (REQ-AA-12, D-38) and the pack records with the pickers'
 * comments (REQ-AA-08, AA-09). Every dispatch is one screen away (REQ-AA-31).
 */
function FulfilmentSections({ record, packs, dispatches }: { record: Estimate; packs: ReturnType<typeof usePackRecords>; dispatches: ReturnType<typeof useDispatches> }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <SectionHeading title="Quantities" note="Every stage moves quantity from one column to the next; the balance is what the pick queue still owes." />
        {record.shortClosedAt !== null ? (
          <Alert>
            <ProhibitIcon />
            <AlertTitle>Short-closed {formatRelativeAge(record.shortClosedAt)}</AlertTitle>
            <AlertDescription>{record.shortCloseReason ?? 'The balance was written off.'}</AlertDescription>
          </Alert>
        ) : null}
        <RecordTable
          columns={QUANTITY_COLUMNS}
          rows={record.lines}
          rowKey={(line) => line.id}
          mobilePrimary={(line) => `${String(line.lineNo)}. ${line.description}`}
          mobileStatus={(line) => {
            const toPack = lineBalances(line).toPack;
            return toPack > 0 ? <Badge variant="outline">{trimZeros(toPack.toFixed(3))} to pack</Badge> : <Badge variant="outline">Packed</Badge>;
          }}
          mobileSupporting={(line) => `Ordered ${trimZeros(line.quantity)} · Packed ${trimZeros(line.packedQty)} · Invoiced ${trimZeros(line.invoicedQty)} · Dispatched ${trimZeros(line.dispatchedQty)}`}
        />
      </div>

      {record.waitingOn.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionHeading title="Waiting on" note="REQ-X-26: what a short pack is waiting for, and the purchase order that will bring it — so sales can say when the rest comes." />
          <ul className="divide-y border">
            {record.waitingOn.map((req) => {
              const short = Math.max(0, Number(req.quantity) - Number(req.receivedQty));
              return (
                <li key={req.requirementId} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{req.stockItemName}</span>
                      <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                        {trimZeros(short.toFixed(3))} short
                        {req.neededBy ? ` · needed by ${formatDate(req.neededBy)}` : ''}
                      </span>
                    </span>
                    <Badge variant={req.state === 'ordered' ? 'default' : 'outline'}>{WAITING_ON_STATE_LABELS[req.state]}</Badge>
                  </div>
                  {req.purchaseOrders.length === 0 ? (
                    <p className="text-muted-foreground text-xs">No purchase order yet.</p>
                  ) : (
                    req.purchaseOrders.map((po) => (
                      <p key={po.id} className="text-xs">
                        <Link to={`/purchase/orders/${po.id}`} className="font-medium underline-offset-4 hover:underline">
                          {po.number}
                        </Link>
                        <span className="text-muted-foreground">
                          {' '}
                          · {po.vendorName} · {trimZeros(po.quantity)} · {po.expectedDate ? `expected ${formatDate(po.expectedDate)}` : 'no expected date'}
                        </span>
                      </p>
                    ))
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <SectionHeading
          title="Invoices"
          note="Raised in Tally and linked on the pull, or raised here (D-38)."
          action={
            <Link to={`/sales/dispatches?order=${record.id}`} className="text-xs underline-offset-4 hover:underline">
              Dispatches against this order
            </Link>
          }
        />
        {record.invoices.length === 0 ? (
          <p className="text-muted-foreground text-xs">None yet. Dispatch waits until an invoice covers the quantity (REQ-AA-14).</p>
        ) : (
          <ul className="divide-y border">
            {record.invoices.map((invoice) => (
              <li key={`${invoice.voucherId ?? ''}-${invoice.invoiceDocumentId ?? ''}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0">
                  {invoice.invoiceDocumentId === null ? (
                    <span className="font-medium">{invoice.voucherNumber}</span>
                  ) : (
                    <Link to={`/sales/invoices/${invoice.invoiceDocumentId}`} className="font-medium underline-offset-4 hover:underline">
                      {invoice.voucherNumber}
                    </Link>
                  )}
                  <span className="text-muted-foreground ml-2 text-xs">{formatDate(invoice.date)}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <Badge variant="outline">{ORDER_INVOICE_METHOD_LABELS[invoice.method]}</Badge>
                  <span className="tabular-nums">{formatMoney(invoice.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading title="Dispatches" note="REQ-AA-31: every dispatch against this order, with its date, mode, LR and quantities." />
        {dispatches.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading dispatches" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-56" />
          </div>
        ) : null}
        {dispatches.isError ? <p className="text-muted-foreground text-xs">Could not load the dispatches: {dispatches.error.message}</p> : null}
        {dispatches.isSuccess && dispatches.data.data.length === 0 ? <p className="text-muted-foreground text-xs">Nothing dispatched yet.</p> : null}
        {dispatches.isSuccess && dispatches.data.data.length > 0 ? (
          <ul className="divide-y border">
            {dispatches.data.data.map((dispatch) => {
              const qty = dispatch.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
              return (
                <li key={dispatch.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 text-xs">
                    <Link to={`/sales/dispatches/${dispatch.id}`} className="font-medium underline-offset-4 hover:underline">
                      {dispatch.number}
                    </Link>
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatDate(dispatch.dispatchedAt)} · {DISPATCH_MODE_LABELS[dispatch.mode]} · LR {dispatch.lrNumber ?? EMPTY_VALUE} · {trimZeros(qty.toFixed(3))} across {String(dispatch.lines.length)} line{dispatch.lines.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <SyncStateBadge record={dispatch} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading title="Pack records" note="Who packed what, when, and what they wanted the office to know." />
        {packs.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading pack records" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-56" />
          </div>
        ) : null}
        {packs.isError ? <p className="text-muted-foreground text-xs">Could not load the pack records: {packs.error.message}</p> : null}
        {packs.isSuccess && packs.data.length === 0 ? <p className="text-muted-foreground text-xs">Nothing packed yet.</p> : null}
        {packs.isSuccess && packs.data.length > 0 ? (
          <ul className="divide-y border">
            {packs.data.map((pack) => (
              <li key={pack.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-xs">
                    <span className="font-medium">{pack.packedByName ?? 'Someone'}</span>
                    <span className="text-muted-foreground"> · {formatRelativeAge(pack.packedAt)} · {String(pack.boxCount)} box{pack.boxCount === 1 ? '' : 'es'}</span>
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {pack.lines.map((l) => `${trimZeros(l.quantity)} × ${l.description}`).join(', ')}
                  </span>
                </div>
                {pack.comment ? <p className="text-xs">{pack.comment}</p> : null}
                {pack.lines.filter((l) => l.comment !== null).map((l) => (
                  <p key={l.lineId} className="text-muted-foreground text-xs">
                    {l.description}: {l.comment}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'sales-order-sheet.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
