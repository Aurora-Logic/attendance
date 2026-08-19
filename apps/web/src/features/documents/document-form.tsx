import { useState, type KeyboardEvent } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';

import { SectionHeading } from '@/components/shared/section-heading';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/features/sales/money';
import { cn } from '@/lib/utils';
import { gstStateName, type DocumentDesign } from '@vyuha/shared';

import type { PaperEditing, PaperModel } from './paper';
import { DETAIL_LABELS, DETAIL_ORDER, E_INVOICE_KEYS, useEnterMoves } from './paper-support';

/**
 * The other way in: the same document typed into a form instead of onto the
 * paper. A person who has never read a tax invoice fills a form top to
 * bottom — who, when, the lines, the details, notes and terms — and the
 * paper fills in beside it (or under Preview on a phone). Nothing here is a
 * second model: the form binds to the same `PaperEditing` callbacks and the
 * same `PaperModel` the paper renders, so either view saves the same draft
 * and the shortcuts (Enter adds a line, Ctrl+A saves) work in both.
 */

const CELL_PREFIX = 'form-';

export function DocumentForm({ model, editing, design, className }: { model: PaperModel; editing: PaperEditing; design: DocumentDesign; className?: string }) {
  const enter = useEnterMoves(editing, model.lines, CELL_PREFIX);
  const isPurchase = model.type === 'PURCHASE_ORDER';
  const details = model.details;
  const shipTo = model.shipTo;
  const detailKeys = DETAIL_ORDER.filter((key) => !E_INVOICE_KEYS.has(key));
  const detailsFilled = detailKeys.some((key) => (details[key] ?? '').trim() !== '');
  const shipToFilled = shipTo !== null && Object.values(shipTo).some((v) => (v ?? '').trim() !== '');
  // Folded until asked for, unless the document already says something there.
  const [detailsOpen, setDetailsOpen] = useState(detailsFilled);
  const [shipToOpen, setShipToOpen] = useState(shipToFilled);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <section className="flex flex-col gap-3">
        <SectionHeading title={isPurchase ? 'Vendor and date' : 'Customer and date'} note={isPurchase ? 'A Tally party under Sundry Creditors.' : 'A Tally party; the GSTIN decides CGST+SGST or IGST.'} />
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>{isPurchase ? 'Vendor' : 'Customer'}</FieldLabel>
            {editing.customer}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Date</FieldLabel>
              {editing.date}
            </Field>
            {editing.validUntil !== undefined ? (
              <Field>
                <FieldLabel>{model.type === 'ESTIMATE' ? 'Valid until' : 'Expected by'}</FieldLabel>
                {editing.validUntil}
              </Field>
            ) : null}
          </div>
          {!isPurchase ? (
            <Field className="sm:max-w-[16rem]">
              <FieldLabel htmlFor="form-place-of-supply">Place of supply (state code)</FieldLabel>
              <Input id="form-place-of-supply" inputMode="numeric" value={model.buyer.stateCode} placeholder="29" onChange={(e) => { editing.setPlaceOfSupply(e.target.value); }} />
              <p className="text-muted-foreground text-xs">{gstStateName(model.buyer.stateCode) || 'From the party’s GSTIN when blank.'}</p>
            </Field>
          ) : null}
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Lines" note="Enter moves down a column and adds a line at the bottom; Tab moves across." />
        <ol className="flex flex-col divide-y border">
          {model.lines.map((line, index) => (
            <li key={line.key} className="flex flex-col gap-2 p-3">
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground w-5 pt-2 text-right text-sm tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">{editing.itemPicker(line)}</div>
                    {editing.itemHistory?.(line)}
                  </div>
                  <Input data-cell={`${CELL_PREFIX}description-${String(index)}`} aria-label={`Line ${String(index + 1)} description`} value={line.description} placeholder="Description" onChange={(e) => { editing.updateLine(line.key, { description: e.target.value }); }} onKeyDown={enter(index, 'description')} />
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${String(index + 1)}`} onClick={() => { editing.removeLine(line.key); }}>
                  <XIcon />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 pl-7 sm:grid-cols-6">
                <LineCell id={`${CELL_PREFIX}qty-${String(index)}`} label="Qty" ariaLabel={`Line ${String(index + 1)} quantity`} value={line.quantity} numeric onChange={(v) => { editing.updateLine(line.key, { quantity: v }); }} onKeyDown={enter(index, 'qty')} />
                {design.showUnit ? <LineCell id={`${CELL_PREFIX}unit-${String(index)}`} label="Unit" ariaLabel={`Line ${String(index + 1)} unit`} value={line.unit} placeholder="No" onChange={(v) => { editing.updateLine(line.key, { unit: v }); }} onKeyDown={enter(index, 'unit')} /> : null}
                <LineCell id={`${CELL_PREFIX}rate-${String(index)}`} label="Rate" ariaLabel={`Line ${String(index + 1)} rate`} value={line.rate} placeholder="0.00" numeric onChange={(v) => { editing.updateLine(line.key, { rate: v }); }} onKeyDown={enter(index, 'rate')} />
                {design.showDiscount ? <LineCell id={`${CELL_PREFIX}disc-${String(index)}`} label="Disc %" ariaLabel={`Line ${String(index + 1)} discount percent`} value={line.discountPct} numeric onChange={(v) => { editing.updateLine(line.key, { discountPct: v }); }} onKeyDown={enter(index, 'disc')} /> : null}
                {design.showTax ? <LineCell id={`${CELL_PREFIX}tax-${String(index)}`} label="Tax %" ariaLabel={`Line ${String(index + 1)} tax percent`} value={line.taxPct} numeric onChange={(v) => { editing.updateLine(line.key, { taxPct: v }); }} onKeyDown={enter(index, 'tax')} /> : null}
                {design.showHsn ? <LineCell id={`${CELL_PREFIX}hsn-${String(index)}`} label="HSN/SAC" ariaLabel={`Line ${String(index + 1)} HSN or SAC`} value={line.hsnCode} placeholder="HSN" onChange={(v) => { editing.updateLine(line.key, { hsnCode: v }); }} onKeyDown={enter(index, 'hsn')} /> : null}
                <div className="col-span-3 flex items-baseline justify-between gap-2 sm:col-span-6">
                  <span className="text-muted-foreground text-xs">Amount</span>
                  <span className="font-medium tabular-nums">{formatMoney(line.amount)}</span>
                </div>
              </div>
            </li>
          ))}
          <li className="p-2">
            <Button type="button" variant="ghost" size="sm" onClick={editing.addLine}>
              <PlusIcon data-icon="inline-start" />
              Add line
              <span className="text-muted-foreground ml-2 text-xs">or press Enter on the last line</span>
            </Button>
          </li>
        </ol>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatMoney(model.totals.subtotal)}</dd>
          {design.showDiscount && Number(model.totals.discountTotal) > 0 ? (
            <>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right tabular-nums">{formatMoney(model.totals.discountTotal)}</dd>
            </>
          ) : null}
          {design.showTax ? (
            <>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right tabular-nums">{formatMoney(model.totals.taxTotal)}</dd>
            </>
          ) : null}
          <dt className="border-t pt-1 font-medium">Total</dt>
          <dd className="border-t pt-1 text-right font-semibold tabular-nums">{formatMoney(model.totals.grandTotal)}</dd>
          {model.totals.preview ? <dd className="text-muted-foreground col-span-2 text-xs">Preview — the server prices it on save.</dd> : null}
        </dl>
      </section>

      {design.showDetailsGrid ? (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <section className="flex flex-col gap-3">
            <SectionHeading
              title="Details"
              note="Delivery note, terms of payment, references, dispatch — the grid on the paper."
              action={
                <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" />}>
                  {detailsOpen ? 'Hide' : detailsFilled ? 'Show' : 'Fill in'}
                </CollapsibleTrigger>
              }
            />
            <CollapsibleContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {detailKeys.map((key) => (
                  <DetailInput key={key} id={`form-detail-${key}`} label={DETAIL_LABELS[key]} value={details[key] ?? ''} multiline={key === 'termsOfDelivery'} onChange={(value) => { editing.updateDetails({ [key]: value }); }} />
                ))}
                {design.showEInvoice
                  ? (['irn', 'ackNo', 'ackDate'] as const).map((key) => (
                      <DetailInput key={key} id={`form-detail-${key}`} label={DETAIL_LABELS[key]} value={details[key] ?? ''} onChange={(value) => { editing.updateDetails({ [key]: value }); }} />
                    ))
                  : null}
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      ) : null}

      {design.showShipTo ? (
        <Collapsible open={shipToOpen} onOpenChange={setShipToOpen}>
          <section className="flex flex-col gap-3">
            <SectionHeading
              title={isPurchase ? 'Deliver to' : 'Ship to'}
              note={isPurchase ? 'Where the goods come; blank means the business address.' : 'The consignee; blank means the same as the buyer.'}
              action={
                <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" />}>
                  {shipToOpen ? 'Hide' : shipToFilled ? 'Show' : 'Fill in'}
                </CollapsibleTrigger>
              }
            />
            <CollapsibleContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="form-shipto-name">Name</FieldLabel>
                  <Input id="form-shipto-name" value={shipTo?.name ?? ''} onChange={(e) => { editing.updateShipTo({ name: e.target.value }); }} />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="form-shipto-address">Address</FieldLabel>
                  <Textarea id="form-shipto-address" rows={2} value={shipTo?.address ?? ''} onChange={(e) => { editing.updateShipTo({ address: e.target.value }); }} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="form-shipto-gstin">GSTIN</FieldLabel>
                  <Input id="form-shipto-gstin" value={shipTo?.gstin ?? ''} onChange={(e) => { editing.updateShipTo({ gstin: e.target.value.toUpperCase() }); }} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="form-shipto-state">State code</FieldLabel>
                  <Input id="form-shipto-state" inputMode="numeric" value={shipTo?.stateCode ?? ''} onChange={(e) => { editing.updateShipTo({ stateCode: e.target.value.replace(/\D/gu, '').slice(0, 2) }); }} />
                </Field>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeading title="Notes and terms" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="form-notes">Notes</FieldLabel>
            <Textarea id="form-notes" rows={3} value={model.notes} placeholder={isPurchase ? 'Anything the vendor should read' : 'Anything the customer should read'} onChange={(e) => { editing.setNotes(e.target.value); }} />
          </Field>
          {design.showTerms ? (
            <Field>
              <FieldLabel htmlFor="form-terms">Terms</FieldLabel>
              <Textarea id="form-terms" rows={3} value={model.terms} placeholder={design.defaultTerms || 'Payment terms, delivery, validity'} onChange={(e) => { editing.setTerms(e.target.value); }} />
            </Field>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LineCell({ id, label, ariaLabel, value, onChange, onKeyDown, placeholder, numeric = false }: { id: string; label: string; ariaLabel: string; value: string; onChange: (value: string) => void; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void; placeholder?: string; numeric?: boolean }) {
  return (
    <Field className="gap-1">
      <FieldLabel htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </FieldLabel>
      <Input id={id} data-cell={id} aria-label={ariaLabel} value={value} placeholder={placeholder} inputMode={numeric ? 'decimal' : undefined} className={cn('h-9', numeric && 'text-right tabular-nums')} onChange={(e) => { onChange(e.target.value); }} onKeyDown={onKeyDown} />
    </Field>
  );
}

function DetailInput({ id, label, value, onChange, multiline = false }: { id: string; label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <Field className={multiline ? 'sm:col-span-2' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? <Textarea id={id} rows={2} value={value} onChange={(e) => { onChange(e.target.value); }} /> : <Input id={id} value={value} onChange={(e) => { onChange(e.target.value); }} />}
    </Field>
  );
}
