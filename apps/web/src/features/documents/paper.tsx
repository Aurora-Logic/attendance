import type { ReactNode } from 'react';
import { PlusIcon, XIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/features/sales/money';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { trimZeros as trimQty } from '@/features/sales/types';
import { PRINTED_DOCUMENT_TITLES, type DocumentDesign, type DocumentProfile, type DocumentTemplateId, type PrintedDocumentType } from '@vyuha/shared';

/**
 * The printed page, and the editor: one A4 sheet rendered from a design and
 * a profile, worn by every document type. In `edit` mode the fields on the
 * paper are the inputs — what is typed where it will print — and the lines
 * are a table whose cells are boxes; in `print` mode the same paper prints.
 * The five templates differ in layout and weight, never in what they say,
 * so a document that moves between them loses nothing.
 *
 * Nothing here is styled inline: the accent is a palette class the sheet
 * reads through `--paper-accent`, and every template is a set of classes.
 */

export interface PaperLine {
  readonly key: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly rate: string;
  readonly discountPct: string;
  readonly taxPct: string;
  /** Null while a line is being typed and the server has not priced it. */
  readonly amount: string | null;
  readonly taxAmount: string | null;
}

export interface PaperTotals {
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  /** True while the figures are the client's preview, not the server's. */
  readonly preview: boolean;
}

export interface PaperModel {
  readonly type: PrintedDocumentType;
  readonly number: string | null;
  readonly statusLabel: string | null;
  readonly date: string;
  readonly validUntil: string | null;
  readonly customerName: string;
  readonly customerDetail: string | null;
  readonly reference: string | null;
  readonly lines: readonly PaperLine[];
  readonly totals: PaperTotals;
  readonly notes: string;
  readonly terms: string;
  /** "Original for Recipient" and the like, on an invoice's copies. */
  readonly copyLabel?: string | null;
}

/** What the page hands the paper when it is the editor. Absent = print. */
export interface PaperEditing {
  readonly customer: ReactNode;
  readonly date: ReactNode;
  readonly validUntil?: ReactNode;
  readonly itemPicker: (line: PaperLine) => ReactNode;
  readonly updateLine: (key: string, patch: Partial<Pick<PaperLine, 'description' | 'quantity' | 'unit' | 'rate' | 'discountPct' | 'taxPct'>>) => void;
  readonly addLine: () => void;
  readonly removeLine: (key: string) => void;
  readonly setNotes: (value: string) => void;
  readonly setTerms: (value: string) => void;
}

interface DocumentPaperProps {
  design: DocumentDesign;
  profile: DocumentProfile;
  logoUrl: string | null;
  orgName: string;
  model: PaperModel;
  editing?: PaperEditing;
  className?: string;
}

interface TemplateStyle {
  sheet: string;
  header: string;
  title: string;
  business: string;
  metaBox: string;
  metaLabel: string;
  addressee: string;
  tableHead: string;
  tableHeadCell: string;
  row: string;
  cell: string;
  totalsBox: string;
  grandTotal: string;
  footer: string;
  section: string;
}

/**
 * Five templates as five sets of classes. Each is a look a person will
 * recognise from a real invoice on their desk — the ruled classic, the
 * banded modern, the hairline minimal, the counter-readable bold, the boxed
 * ledger — chosen so the same content reads right in every one.
 */
const TEMPLATES: Record<DocumentTemplateId, TemplateStyle> = {
  classic: {
    sheet: 'p-[14mm] font-sans',
    header: 'flex items-start justify-between gap-6 border-b-2 border-[var(--paper-accent)] pb-4',
    title: 'font-serif text-[2.2em] leading-none tracking-tight text-[var(--paper-accent)]',
    business: 'text-right',
    metaBox: 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5',
    metaLabel: 'text-[0.85em] uppercase tracking-wide text-neutral-500',
    addressee: '',
    tableHead: '',
    tableHeadCell: 'border-b-2 border-[var(--paper-accent)] text-[0.85em] uppercase tracking-wide text-neutral-600',
    row: 'border-b border-neutral-200',
    cell: 'align-top py-1.5',
    totalsBox: 'ml-auto w-[38%] min-w-[220px] border-t-2 border-[var(--paper-accent)] pt-2',
    grandTotal: 'border-t border-neutral-300 pt-1 text-[1.15em] font-semibold',
    footer: 'border-t border-neutral-200 pt-3 text-[0.85em] text-neutral-500',
    section: 'text-[0.85em] uppercase tracking-wide text-neutral-500',
  },
  modern: {
    sheet: 'p-0 font-sans',
    header: 'flex items-start justify-between gap-6 bg-[var(--paper-accent)] px-[14mm] py-6 text-white',
    title: 'text-[2em] font-semibold leading-none tracking-tight',
    business: 'text-right text-white/90',
    metaBox: 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5',
    metaLabel: 'text-[0.85em] text-neutral-500',
    addressee: '',
    tableHead: '',
    tableHeadCell: 'bg-[var(--paper-accent-soft)] text-[0.85em] font-semibold text-[var(--paper-accent)] first:rounded-l last:rounded-r',
    row: 'border-b border-neutral-100',
    cell: 'align-top py-2',
    totalsBox: 'ml-auto w-[38%] min-w-[220px] rounded bg-[var(--paper-accent-soft)] p-3',
    grandTotal: 'mt-1 border-t border-[var(--paper-accent)]/30 pt-1 text-[1.2em] font-semibold text-[var(--paper-accent)]',
    footer: 'text-[0.85em] text-neutral-500',
    section: 'text-[0.85em] font-semibold text-[var(--paper-accent)]',
  },
  minimal: {
    sheet: 'p-[16mm] font-sans',
    header: 'flex items-start justify-between gap-6 pb-6',
    title: 'text-[1.1em] uppercase tracking-[0.3em] text-neutral-500',
    business: 'text-right',
    metaBox: 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5',
    metaLabel: 'text-[0.85em] text-neutral-400',
    addressee: '',
    tableHead: '',
    tableHeadCell: 'border-b border-neutral-300 pb-2 text-[0.8em] font-medium uppercase tracking-wider text-neutral-500',
    row: 'border-b border-neutral-100',
    cell: 'align-top py-2.5',
    totalsBox: 'ml-auto w-[38%] min-w-[220px] pt-2',
    grandTotal: 'border-t border-neutral-900 pt-1.5 text-[1.15em] font-medium',
    footer: 'pt-4 text-[0.8em] text-neutral-400',
    section: 'text-[0.8em] uppercase tracking-wider text-neutral-400',
  },
  bold: {
    sheet: 'p-0 font-sans',
    header: 'flex items-start justify-between gap-6 bg-[var(--paper-accent)] px-[14mm] py-8 text-white',
    title: 'text-[3em] font-black uppercase leading-none tracking-tighter',
    business: 'text-right text-white/90',
    metaBox: 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5',
    metaLabel: 'text-[0.85em] font-semibold uppercase text-neutral-500',
    addressee: 'text-[1.1em]',
    tableHead: '',
    tableHeadCell: 'bg-neutral-900 text-[0.85em] font-semibold uppercase tracking-wide text-white',
    row: 'border-b-2 border-neutral-100',
    cell: 'align-top py-2 font-medium',
    totalsBox: 'ml-auto w-[42%] min-w-[240px]',
    grandTotal: 'mt-2 bg-[var(--paper-accent)] px-3 py-2 text-[1.35em] font-black text-white',
    footer: 'text-[0.85em] font-medium text-neutral-500',
    section: 'text-[0.85em] font-black uppercase tracking-wide',
  },
  ledger: {
    sheet: 'p-[10mm] font-sans',
    header: 'grid grid-cols-[1fr_auto] gap-4 border border-neutral-800 p-3',
    title: 'text-[1.4em] font-bold uppercase',
    business: 'text-right',
    metaBox: 'grid grid-cols-[auto_1fr] gap-x-2 border border-neutral-800 p-2 [&>*]:border-b [&>*]:border-neutral-200 [&>*:nth-last-child(-n+2)]:border-b-0',
    metaLabel: 'text-[0.85em] font-semibold',
    addressee: 'border border-neutral-800 p-2',
    tableHead: '',
    tableHeadCell: 'border border-neutral-800 bg-neutral-100 text-[0.85em] font-bold',
    row: '',
    cell: 'border border-neutral-800 py-1 align-top tabular-nums',
    totalsBox: 'ml-auto w-[38%] min-w-[220px] border border-neutral-800 [&>*]:border-b [&>*]:border-neutral-300 [&>*:last-child]:border-b-0 [&>*]:px-2',
    grandTotal: 'bg-neutral-100 text-[1.1em] font-bold',
    footer: 'border border-neutral-800 p-2 text-[0.85em]',
    section: 'text-[0.85em] font-bold uppercase',
  },
};

/** The one look-alike input: a box on screen, plain text on paper. */
export function PaperField({ value, onChange, placeholder, className, label, align = 'left' }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string; label: string; align?: 'left' | 'right' }) {
  return (
    <Input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className={cn('paper-field w-full', align === 'right' && 'text-right tabular-nums', className)}
    />
  );
}

function PaperArea({ value, onChange, placeholder, label, rows = 3 }: { value: string; onChange: (value: string) => void; placeholder?: string; label: string; rows?: number }) {
  return <Textarea aria-label={label} rows={rows} value={value} placeholder={placeholder} onChange={(event) => { onChange(event.target.value); }} className="paper-field w-full resize-none" />;
}

export function DocumentPaper({ design, profile, logoUrl, orgName, model, editing, className }: DocumentPaperProps) {
  const t = TEMPLATES[design.templateId];
  const editable = editing !== undefined;
  const banded = design.templateId === 'modern' || design.templateId === 'bold';
  const bodyPad = banded ? 'px-[14mm] pb-[14mm] pt-6' : '';
  const businessName = profile.legalName.trim() === '' ? orgName : profile.legalName;
  const addressLines = profile.addressLines.split('\n').filter((line) => line.trim() !== '');
  const showAmounts = true;
  const columns = 2 + (design.showUnit ? 1 : 0) + 1 + (design.showDiscount ? 1 : 0) + (design.showTax ? 1 : 0) + (showAmounts ? 1 : 0);

  const logo = logoUrl !== null && design.logoPlacement !== 'none' ? <img src={logoUrl} alt="" className="max-h-16 max-w-[48mm] object-contain" /> : null;
  const business = (
    <div className={cn('flex flex-col gap-0.5', t.business)}>
      <div className="text-[1.15em] font-semibold">{businessName}</div>
      {addressLines.map((line) => (
        <div key={line} className="text-[0.9em]">{line}</div>
      ))}
      <div className="text-[0.85em]">
        {[profile.gstin ? `GSTIN ${profile.gstin}` : null, profile.pan ? `PAN ${profile.pan}` : null].filter(Boolean).join(' · ')}
      </div>
      <div className="text-[0.85em]">{[profile.phone, profile.email, profile.website].filter((p) => p.trim() !== '').join(' · ')}</div>
    </div>
  );
  const identity = (
    <div className={cn('flex items-start gap-4', design.logoPlacement === 'right' && 'flex-row-reverse text-right')}>
      {logo}
      {design.templateId === 'ledger' ? business : null}
    </div>
  );

  return (
    <article
      className={cn('a4-paper shadow-sm ring-1 ring-black/5', t.sheet, className)}
      data-accent={design.accent}
      data-scale={design.fontScale}
      data-mode={editable ? 'edit' : 'print'}
      data-template={design.templateId}
      aria-label={`${PRINTED_DOCUMENT_TITLES[model.type]} ${model.number ?? 'draft'}`}
    >
      <header className={t.header}>
        <div className="flex flex-col gap-3">
          {design.templateId === 'ledger' ? (
            <div className={t.title}>{PRINTED_DOCUMENT_TITLES[model.type]}</div>
          ) : (
            <>
              {identity}
              <div className={t.title}>{PRINTED_DOCUMENT_TITLES[model.type]}</div>
            </>
          )}
          {model.copyLabel ? <div className="text-[0.85em] font-medium uppercase tracking-wide opacity-80">{model.copyLabel}</div> : null}
        </div>
        {design.templateId === 'ledger' ? identity : business}
      </header>

      <div className={cn('flex flex-col gap-6', bodyPad, banded ? '' : 'pt-6')}>
        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          <div className={cn('flex flex-col gap-1', t.addressee)}>
            <div className={t.section}>{model.type === 'PURCHASE_ORDER' ? 'Vendor' : 'Bill to'}</div>
            {editable ? editing.customer : <div className="text-[1.05em] font-semibold">{model.customerName || '—'}</div>}
            {model.customerDetail ? <div className="whitespace-pre-line text-[0.9em] text-neutral-600">{model.customerDetail}</div> : null}
          </div>
          <div className={cn(t.metaBox, 'min-w-[60mm] self-start text-[0.95em]')}>
            <span className={t.metaLabel}>Number</span>
            <span className="font-medium tabular-nums">{model.number ?? 'Draft'}</span>
            <span className={t.metaLabel}>Date</span>
            <span className="tabular-nums">{editable ? editing.date : formatDate(model.date)}</span>
            {model.type === 'ESTIMATE' ? (
              <>
                <span className={t.metaLabel}>Valid until</span>
                <span className="tabular-nums">{editable && editing.validUntil !== undefined ? editing.validUntil : model.validUntil ? formatDate(model.validUntil) : '—'}</span>
              </>
            ) : null}
            {model.reference ? (
              <>
                <span className={t.metaLabel}>Reference</span>
                <span>{model.reference}</span>
              </>
            ) : null}
            {model.statusLabel && editable ? (
              <>
                <span className={t.metaLabel}>Status</span>
                <span>{model.statusLabel}</span>
              </>
            ) : null}
          </div>
        </div>

        <Table className="text-[1em]">
          <TableHeader className={t.tableHead}>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(t.tableHeadCell, 'w-8')}>#</TableHead>
              <TableHead className={t.tableHeadCell}>Description</TableHead>
              <TableHead className={cn(t.tableHeadCell, 'w-[14%] text-right')}>Qty</TableHead>
              {design.showUnit ? <TableHead className={cn(t.tableHeadCell, 'w-[10%]')}>Unit</TableHead> : null}
              <TableHead className={cn(t.tableHeadCell, 'w-[14%] text-right')}>Rate</TableHead>
              {design.showDiscount ? <TableHead className={cn(t.tableHeadCell, 'w-[9%] text-right')}>Disc %</TableHead> : null}
              {design.showTax ? <TableHead className={cn(t.tableHeadCell, 'w-[9%] text-right')}>Tax %</TableHead> : null}
              <TableHead className={cn(t.tableHeadCell, 'w-[16%] text-right')}>Amount</TableHead>
              {editable ? <TableHead className={cn(t.tableHeadCell, 'w-8 print-hidden')}> </TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.lines.map((line, index) => (
              <TableRow key={line.key} className={cn(t.row, 'hover:bg-transparent')}>
                <TableCell className={cn(t.cell, 'text-neutral-500 tabular-nums')}>{index + 1}</TableCell>
                <TableCell className={cn(t.cell, 'whitespace-normal')}>
                  {editable ? (
                    <div className="flex flex-col gap-1">
                      {editing.itemPicker(line)}
                      <PaperField label={`Line ${String(index + 1)} description`} value={line.description} placeholder="Description" onChange={(value) => { editing.updateLine(line.key, { description: value }); }} />
                    </div>
                  ) : (
                    line.description
                  )}
                </TableCell>
                <TableCell className={cn(t.cell, 'text-right tabular-nums')}>
                  {editable ? <PaperField align="right" label={`Line ${String(index + 1)} quantity`} value={line.quantity} onChange={(value) => { editing.updateLine(line.key, { quantity: value }); }} /> : trimQty(line.quantity)}
                </TableCell>
                {design.showUnit ? (
                  <TableCell className={t.cell}>{editable ? <PaperField label={`Line ${String(index + 1)} unit`} value={line.unit} placeholder="Unit" onChange={(value) => { editing.updateLine(line.key, { unit: value }); }} /> : line.unit}</TableCell>
                ) : null}
                <TableCell className={cn(t.cell, 'text-right tabular-nums')}>
                  {editable ? <PaperField align="right" label={`Line ${String(index + 1)} rate`} value={line.rate} placeholder="0.00" onChange={(value) => { editing.updateLine(line.key, { rate: value }); }} /> : formatMoney(line.rate)}
                </TableCell>
                {design.showDiscount ? (
                  <TableCell className={cn(t.cell, 'text-right tabular-nums')}>
                    {editable ? <PaperField align="right" label={`Line ${String(index + 1)} discount percent`} value={line.discountPct} onChange={(value) => { editing.updateLine(line.key, { discountPct: value }); }} /> : trimQty(line.discountPct)}
                  </TableCell>
                ) : null}
                {design.showTax ? (
                  <TableCell className={cn(t.cell, 'text-right tabular-nums')}>
                    {editable ? <PaperField align="right" label={`Line ${String(index + 1)} tax percent`} value={line.taxPct} onChange={(value) => { editing.updateLine(line.key, { taxPct: value }); }} /> : trimQty(line.taxPct)}
                  </TableCell>
                ) : null}
                <TableCell className={cn(t.cell, 'text-right font-medium tabular-nums')}>{formatMoney(line.amount)}</TableCell>
                {editable ? (
                  <TableCell className={cn(t.cell, 'print-hidden')}>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove line ${String(index + 1)}`} onClick={() => { editing.removeLine(line.key); }}>
                      <XIcon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {editable ? (
              <TableRow className="print-hidden hover:bg-transparent">
                <TableCell colSpan={columns + 1} className="py-1">
                  <Button type="button" variant="ghost" size="sm" onClick={editing.addLine} className="text-[var(--paper-accent)]">
                    <PlusIcon data-icon="inline-start" />
                    Add line
                  </Button>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-4">
            {editable || model.notes.trim() !== '' ? (
              <div className="flex flex-col gap-1">
                <div className={t.section}>Notes</div>
                {editable ? <PaperArea label="Notes" value={model.notes} placeholder="Anything the customer should read" onChange={editing.setNotes} /> : <p className="whitespace-pre-line text-[0.95em]">{model.notes}</p>}
              </div>
            ) : null}
            {design.showTerms && (editable || model.terms.trim() !== '') ? (
              <div className="flex flex-col gap-1">
                <div className={t.section}>Terms</div>
                {editable ? <PaperArea label="Terms" value={model.terms} placeholder={design.defaultTerms || 'Payment terms, delivery, validity'} onChange={editing.setTerms} /> : <p className="whitespace-pre-line text-[0.9em] text-neutral-700">{model.terms}</p>}
              </div>
            ) : null}
            {design.showBank && profile.bankAccount.trim() !== '' ? (
              <div className="flex flex-col gap-0.5">
                <div className={t.section}>Bank</div>
                <div className="text-[0.9em]">{[profile.bankName, profile.bankBranch].filter((p) => p.trim() !== '').join(', ')}</div>
                <div className="text-[0.9em] tabular-nums">A/c {profile.bankAccount}{profile.bankIfsc ? ` · IFSC ${profile.bankIfsc}` : ''}</div>
              </div>
            ) : null}
          </div>
          <div className={cn(t.totalsBox, 'flex flex-col gap-1 text-[0.95em]')}>
            <Row label="Subtotal" value={model.totals.subtotal} />
            {design.showDiscount ? <Row label="Discount" value={model.totals.discountTotal} /> : null}
            {design.showTax ? <Row label="Tax" value={model.totals.taxTotal} /> : null}
            <div className={cn('flex items-baseline justify-between gap-4', t.grandTotal)}>
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(model.totals.grandTotal)}</span>
            </div>
            {model.totals.preview && editable ? <div className="print-hidden text-[0.8em] text-neutral-500">Preview — the server prices it on save.</div> : null}
          </div>
        </div>

        {design.showSignature || design.footerNote.trim() !== '' ? (
          <footer className={cn('mt-auto flex items-end justify-between gap-6', t.footer)}>
            <div>{design.footerNote}</div>
            {design.showSignature ? (
              <div className="flex flex-col items-end gap-8 text-right">
                <div>For {businessName}</div>
                <div className="border-t border-neutral-400 pt-1">{profile.signatoryName.trim() === '' ? 'Authorised signatory' : profile.signatoryName}</div>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-neutral-600">{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

