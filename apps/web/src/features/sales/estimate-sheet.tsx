import { useState } from 'react';
import { BooksIcon, BuildingsIcon, PlusIcon, TrashIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { RecordPicker, type PickerOption } from '@/components/shared/record-picker';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';
import { useCompanyOptions } from '@/features/crm/use-crm';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useParties } from '@/features/masters/use-parties';
import { useStockItems } from '@/features/masters/use-stock-items';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import { ESTIMATE_STATUS_LABELS, ESTIMATE_TRANSITIONS, PERMISSIONS, type EstimateStatus } from '@vyuha/shared';

import { ItemHistoryAffordance } from './item-history-popover';
import { formatMoney } from './money';
import { newLine, previewLine, type Estimate, type EstimateDraft, type LineDraft } from './types';
import { useDeleteEstimate, useSaveEstimate, useSetEstimateStatus } from './use-estimates';

/**
 * One estimate (REQ-W-01): the header, the line editor, the totals, and the
 * status controls. Wider than the record sheets because a line has six
 * columns; on a phone the lines stack. Every control is a keyboard control
 * and Ctrl+A saves; Enter on the last line's last box adds a line, the way
 * Tally's voucher entry runs on — Alt+N is the calculator's, globally.
 *
 * Amounts while typing are a preview (`previewLine`), replaced by the
 * server's figures on save; the footer says so until then.
 */

interface EstimateSheetProps {
  draft: EstimateDraft | null;
  record?: Estimate | null;
  onOpenChange: (open: boolean) => void;
}

export function EstimateSheet({ draft, record, onOpenChange }: EstimateSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={draft !== null} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-3xl max-md:max-h-[92vh]">
        {draft ? (
          <EstimateSheetBody
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

function EstimateSheetBody({ initial, record, onClose }: { initial: EstimateDraft; record: Estimate | null; onClose: () => void }) {
  const [draft, setDraft] = useState<EstimateDraft>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveEstimate();
  const setStatus = useSetEstimateStatus();
  const remove = useDeleteEstimate();
  const canSeeParties = usePermission(PERMISSIONS.MASTERS_TALLY_VIEW);
  const canSeeCompanies = usePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF);
  const parties = useParties({ page: 1 }, { enabled: canSeeParties });
  const companies = useCompanyOptions({ enabled: canSeeCompanies });
  const items = useStockItems({ page: 1 }, { enabled: canSeeParties });
  const isNew = initial.id === undefined;
  const editable = draft.status === 'DRAFT';

  const partyOptions: PickerOption[] = (parties.data?.data ?? []).map((p) => ({ id: p.id, label: p.name, ...(p.gstin === null ? {} : { hint: p.gstin }) }));
  const companyOptions: PickerOption[] = (companies.data ?? []).map((c) => ({ id: c.id, label: c.name, ...(c.city === null ? {} : { hint: c.city }) }));
  const itemOptions: PickerOption[] = (items.data?.data ?? []).map((i) => ({ id: i.id, label: i.name, hint: [i.unit, i.salePrice === null || i.salePrice === undefined ? null : `@ ${i.salePrice}`].filter((p): p is string => p !== null).join(' ') }));
  const pick = (options: PickerOption[], id: string | null) => options.find((o) => o.id === id) ?? null;

  const customerMissing = draft.partyId === null && draft.companyId === null && draft.customerName.trim() === '';
  const preview = draft.lines.map(previewLine);
  const previewSubtotal = preview.reduce((sum, p, i) => sum + (p === null ? 0 : Number(draft.lines[i]?.quantity ?? 0) * Number(draft.lines[i]?.rate ?? 0)), 0);
  const previewNet = preview.reduce((sum, p) => sum + (p?.amount ?? 0), 0);
  const previewTax = preview.reduce((sum, p) => sum + (p?.tax ?? 0), 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  }
  function addLine() {
    if (!editable) return;
    const added = newLine();
    setDraft((current) => ({ ...current, lines: [...current.lines, added] }));
    // Focus the new line's description once it exists.
    window.requestAnimationFrame(() => {
      const next = document.querySelector<HTMLInputElement>(`input[aria-label="Line ${String(draft.lines.length + 1)} description"]`);
      next?.focus();
    });
  }
  function removeLine(key: string) {
    setDraft((current) => ({ ...current, lines: current.lines.length === 1 ? [newLine()] : current.lines.filter((l) => l.key !== key) }));
  }
  function chooseItem(key: string, option: PickerOption | null) {
    const item = (items.data?.data ?? []).find((i) => i.id === option?.id);
    updateLine(key, {
      stockItemId: item?.id ?? null,
      description: item?.name ?? '',
      unit: item?.unit ?? '',
      rate: item?.salePrice === null || item?.salePrice === undefined ? '' : item.salePrice.replace(/\.?0+$/u, ''),
      taxPct: item?.gstRate === null || item?.gstRate === undefined ? '0' : String(Number(item.gstRate)),
    });
  }

  function submit() {
    if (customerMissing || save.isPending || !editable) return;
    save.mutate(draft, {
      onSuccess: (saved) => {
        toast.add({ type: 'success', title: isNew ? `${saved.number} raised` : `${saved.number} saved`, description: `${saved.customerName} · ${formatMoney(saved.grandTotal)}` });
        onClose();
      },
    });
  }

  function move(status: EstimateStatus) {
    if (initial.id === undefined) return;
    setStatus.mutate(
      { id: initial.id, status },
      {
        onSuccess: (saved) => {
          toast.add({ type: 'success', title: `${saved.number} ${ESTIMATE_STATUS_LABELS[saved.status].toLowerCase()}` });
          onClose();
        },
      },
    );
  }

  const failure = save.error ?? setStatus.error ?? remove.error;
  const copy = actionErrorCopy(failure, save.error ? 'Saving the estimate' : setStatus.error ? 'Changing the status' : 'Deleting the estimate');
  const nextStatuses = ESTIMATE_TRANSITIONS[draft.status];

  return (
    <ShortcutLayer id={`modal:estimate-${initial.id ?? 'new'}`}>
      <SheetShortcuts onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle className="flex items-center gap-2">
          {isNew ? 'New estimate' : `Estimate ${initial.number ?? ''}`}
          {isNew ? null : <Badge variant={draft.status === 'ACCEPTED' ? 'default' : 'outline'}>{ESTIMATE_STATUS_LABELS[draft.status]}</Badge>}
        </SheetTitle>
        <SheetDescription>
          {isNew
            ? 'Vyuha-owned; never pushed to Tally. Taxes are shown for information.'
            : editable
              ? 'A draft: lines and header may change. Sending it makes it read-only.'
              : `Read-only while ${ESTIMATE_STATUS_LABELS[draft.status].toLowerCase()}. ${record?.ownerName ? `Owned by ${record.ownerName}.` : ''}`}
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

          <div className="grid gap-4 sm:grid-cols-2">
            {canSeeParties ? (
              <Field>
                <FieldLabel htmlFor="estimate-party">Tally party</FieldLabel>
                <RecordPicker
                  id="estimate-party"
                  label="Tally party"
                  placeholder="Not a party yet"
                  searchPlaceholder="Search parties"
                  emptyMessage="No party matches. A prospect can be a company or a name."
                  icon={<BooksIcon className="text-muted-foreground" />}
                  options={partyOptions}
                  loading={parties.isPending}
                  clearable
                  clearLabel="Not a party yet"
                  disabled={!editable}
                  value={pick(partyOptions, draft.partyId)}
                  onValueChange={(next) => {
                    setDraft((current) => ({ ...current, partyId: next?.id ?? null, customerName: next?.label ?? current.customerName }));
                  }}
                />
              </Field>
            ) : null}
            {canSeeCompanies ? (
              <Field>
                <FieldLabel htmlFor="estimate-company">CRM company</FieldLabel>
                <RecordPicker
                  id="estimate-company"
                  label="CRM company"
                  placeholder="No company"
                  searchPlaceholder="Search companies"
                  emptyMessage="No company matches."
                  icon={<BuildingsIcon className="text-muted-foreground" />}
                  options={companyOptions}
                  loading={companies.isPending}
                  clearable
                  clearLabel="No company"
                  disabled={!editable}
                  value={pick(companyOptions, draft.companyId)}
                  onValueChange={(next) => {
                    setDraft((current) => ({
                      ...current,
                      companyId: next?.id ?? null,
                      customerName: current.partyId === null ? (next?.label ?? current.customerName) : current.customerName,
                    }));
                  }}
                />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="sm:col-span-1">
              <FieldLabel htmlFor="estimate-customer">Addressed to</FieldLabel>
              <Input
                id="estimate-customer"
                autoComplete="organization"
                className="pointer-coarse:h-11"
                placeholder="Customer name as printed"
                disabled={!editable}
                value={draft.customerName}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, customerName: event.target.value }));
                }}
              />
            </Field>
            <Field>
              <FieldLabel>Date</FieldLabel>
              <DateField
                label="Estimate date"
                value={fromDateParam(draft.date)}
                onValueChange={(next) => {
                  if (editable) setDraft((current) => ({ ...current, date: toDateParam(next) }));
                }}
                yearsBack={1}
                yearsForward={1}
              />
            </Field>
            <Field>
              <FieldLabel>Valid until</FieldLabel>
              {draft.validUntil === null ? (
                <Button
                  type="button"
                  variant="outline"
                  className="pointer-coarse:h-11 w-full justify-start font-normal"
                  disabled={!editable}
                  onClick={() => {
                    setDraft((current) => ({ ...current, validUntil: toDateParam(new Date(Date.now() + 30 * 86_400_000)) }));
                  }}
                >
                  <span className="text-muted-foreground">Open-ended — set a date</span>
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <DateField
                      label="Valid until"
                      value={fromDateParam(draft.validUntil)}
                      onValueChange={(next) => {
                        if (editable) setDraft((current) => ({ ...current, validUntil: toDateParam(next) }));
                      }}
                      yearsBack={0}
                      yearsForward={2}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Clear valid-until"
                    disabled={!editable}
                    onClick={() => {
                      setDraft((current) => ({ ...current, validUntil: null }));
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Lines</span>
            {editable ? (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <PlusIcon data-icon="inline-start" />
                Add line
              </Button>
            ) : null}
          </div>

          <ol className="flex flex-col divide-y border">
            {draft.lines.map((line, index) => {
              const p = preview[index] ?? null;
              return (
                <li key={line.key} className="flex flex-col gap-2 p-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                    <div className="flex flex-col gap-1">
                      {canSeeParties ? (
                        <RecordPicker
                          id={`line-item-${line.key}`}
                          label={`Line ${String(index + 1)} item`}
                          placeholder="Stock item, or type a description below"
                          searchPlaceholder="Search stock items"
                          emptyMessage="No item matches. Leave it and type a description."
                          options={itemOptions}
                          loading={items.isPending}
                          clearable
                          clearLabel="No stock item"
                          disabled={!editable}
                          value={pick(itemOptions, line.stockItemId)}
                          onValueChange={(next) => {
                            chooseItem(line.key, next);
                          }}
                        />
                      ) : null}
                      <Input
                        aria-label={`Line ${String(index + 1)} description`}
                        className="pointer-coarse:h-11"
                        placeholder="Description"
                        disabled={!editable}
                        value={line.description}
                        onChange={(event) => {
                          updateLine(line.key, { description: event.target.value });
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Input aria-label={`Line ${String(index + 1)} quantity`} inputMode="decimal" className="pointer-coarse:h-11 tabular-nums" placeholder="Qty" disabled={!editable} value={line.quantity} onChange={(e) => { updateLine(line.key, { quantity: e.target.value }); }} />
                      <Input aria-label={`Line ${String(index + 1)} rate`} inputMode="decimal" className="pointer-coarse:h-11 tabular-nums" placeholder="Rate" disabled={!editable} value={line.rate} onChange={(e) => { updateLine(line.key, { rate: e.target.value }); }} />
                      <Input aria-label={`Line ${String(index + 1)} discount percent`} inputMode="decimal" className="pointer-coarse:h-11 tabular-nums" placeholder="Disc %" disabled={!editable} value={line.discountPct} onChange={(e) => { updateLine(line.key, { discountPct: e.target.value }); }} />
                      <Input
                        aria-label={`Line ${String(index + 1)} tax percent`}
                        inputMode="decimal"
                        className="pointer-coarse:h-11 tabular-nums"
                        placeholder="Tax %"
                        disabled={!editable}
                        value={line.taxPct}
                        onChange={(e) => { updateLine(line.key, { taxPct: e.target.value }); }}
                        onKeyDown={(e) => {
                          // Enter on the last box of the last line appends a line, as voucher entry does.
                          if (e.key === 'Enter' && index === draft.lines.length - 1) {
                            e.preventDefault();
                            addLine();
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-start justify-end gap-1">
                      <ItemHistoryAffordance stockItemId={line.stockItemId} partyId={draft.partyId} companyId={draft.companyId} />
                      {editable ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${String(index + 1)}`} onClick={() => { removeLine(line.key); }}>
                          <TrashIcon />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-muted-foreground flex justify-end gap-4 text-xs tabular-nums">
                    <span>{line.unit ? `per ${line.unit}` : ''}</span>
                    <span>{p === null ? '—' : `${formatMoney(p.amount.toFixed(2))}${p.tax > 0 ? ` + tax ${formatMoney(p.tax.toFixed(2))}` : ''}`}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{formatMoney((dirty || record === null ? previewSubtotal : Number(record.subtotal)).toFixed(2))}</dd>
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="text-right">{formatMoney((dirty || record === null ? previewSubtotal - previewNet : Number(record.discountTotal)).toFixed(2))}</dd>
            <dt className="text-muted-foreground">Tax (for information)</dt>
            <dd className="text-right">{formatMoney((dirty || record === null ? previewTax : Number(record.taxTotal)).toFixed(2))}</dd>
            <dt className="font-medium">Total</dt>
            <dd className={cn('text-right font-medium')}>{formatMoney((dirty || record === null ? previewNet + previewTax : Number(record.grandTotal)).toFixed(2))}</dd>
          </dl>
          {dirty && editable ? <FieldDescription className="text-right">Preview — the server computes the figures on save.</FieldDescription> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="estimate-notes">Notes</FieldLabel>
              <Textarea id="estimate-notes" rows={3} disabled={!editable} value={draft.notes} onChange={(e) => { setDraft((c) => ({ ...c, notes: e.target.value })); }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="estimate-terms">Terms</FieldLabel>
              <Textarea id="estimate-terms" rows={3} disabled={!editable} value={draft.terms} onChange={(e) => { setDraft((c) => ({ ...c, terms: e.target.value })); }} />
            </Field>
          </div>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t">
        {!isNew && editable ? (
          confirmDelete ? (
            <span className="mr-auto flex items-center gap-2 text-sm">
              Delete this draft?
              <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => { if (initial.id) remove.mutate(initial.id, { onSuccess: () => { toast.add({ type: 'success', title: `${initial.number ?? 'Draft'} deleted` }); onClose(); } }); }}>
                {remove.isPending ? <Spinner data-icon="inline-start" /> : <TrashIcon data-icon="inline-start" />}
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfirmDelete(false); }}>Keep</Button>
            </span>
          ) : (
            <Button variant="outline" className="mr-auto" onClick={() => { setConfirmDelete(true); }} aria-label={`Delete ${initial.number ?? 'draft'}`}>
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
          )
        ) : null}
        {!isNew && nextStatuses.length > 0 ? (
          <Select
            value=""
            onValueChange={(next: string | null) => {
              const parsed = nextStatuses.find((s) => s === next);
              if (parsed) move(parsed);
            }}
          >
            <SelectTrigger aria-label="Change status" className="pointer-coarse:h-11 w-40" disabled={setStatus.isPending}>
              <SelectValue placeholder="Mark as…">{() => 'Mark as…'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {nextStatuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {ESTIMATE_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          {editable ? 'Cancel' : 'Close'}
        </Button>
        {editable ? (
          <Button disabled={save.isPending || customerMissing} onClick={submit}>
            {save.isPending ? <Spinner data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
            {save.isPending ? 'Saving' : 'Save'}
            <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
          </Button>
        ) : null}
      </SheetFooter>
    </ShortcutLayer>
  );
}

function SheetShortcuts({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'estimate-sheet.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'modal', allowInInput: true, run: onSave });
  return null;
}
