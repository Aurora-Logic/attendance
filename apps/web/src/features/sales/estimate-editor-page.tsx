import { useState } from 'react';
import { addDays } from 'date-fns';
import { ArrowLeftIcon, ArrowRightIcon, BooksIcon, BuildingsIcon, EyeIcon, FileXlsIcon, PaintBrushIcon, PencilSimpleIcon, PrinterIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { RecordPicker, type PickerOption } from '@/components/shared/record-picker';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useCompanyOptions } from '@/features/crm/use-crm';
import { DesignRail } from '@/features/documents/design-rail';
import { downloadDocumentFile } from '@/features/documents/download';
import { DocumentPaper, PaperField, type PaperEditing, type PaperLine, type PaperModel } from '@/features/documents/paper';
import { useDocumentSettings, useSaveDocumentSettings } from '@/features/documents/use-document-settings';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useParties } from '@/features/masters/use-parties';
import { useStockItems } from '@/features/masters/use-stock-items';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBranding } from '@/lib/branding/use-branding';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { ESTIMATE_TRANSITIONS, PERMISSIONS, SALES_DOCUMENT_STATUS_LABELS, isEstimateStatus, type DocumentSettings, type EstimateStatus } from '@vyuha/shared';

import { formatMoney } from './money';
import { emptyEstimateDraft, estimateToDraft, newLine, previewLine, type Estimate, type EstimateDraft, type LineDraft } from './types';
import { useConvertEstimate, useDeleteEstimate, useEstimate, useSaveEstimate, useSetEstimateStatus } from './use-estimates';

/**
 * The estimate, as the page it prints on (REQ-W-01). The paper is the
 * editor: the customer, the dates, every line and the terms are typed where
 * they will print, and the design rail beside it changes the template, the
 * accent and the blocks live. Preview flips the same paper to print view;
 * PDF opens the print route in its own tab, where the browser's print-to-PDF
 * makes an A4 page; Excel downloads the workbook.
 *
 * A page, not a sheet, because a document is worked on — a sheet is for a
 * record you glance at and close. Ctrl+A saves; Enter in the last line's
 * last box adds a line, the way Tally's voucher entry runs on.
 */

export function EstimateEditorPage() {
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const isNew = params.id === undefined || params.id === 'new';
  const canViewSelf = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_SELF);
  const canViewAll = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_ALL);
  const canView = canViewSelf || canViewAll;
  const canCreate = usePermission(PERMISSIONS.SALES_DOCUMENT_CREATE);
  const record = useEstimate(canView && !isNew ? (params.id ?? null) : null);
  const settings = useDocumentSettings({ enabled: canView });
  const branding = useBranding({ enabled: canView });

  if (!canView || (isNew && !canCreate)) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>{isNew ? 'You cannot raise estimates' : 'You cannot view estimates'}</EmptyTitle>
          <EmptyDescription>{isNew ? 'This needs sales.document.create — the Sales role carries it.' : 'This needs sales.document.view.self or sales.document.view.all.'}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!isNew && record.isError) {
    return (
      <QueryErrorAlert
        error={record.error}
        subject="that estimate"
        onRetry={() => {
          void record.refetch();
        }}
      />
    );
  }
  if ((!isNew && record.data === undefined) || settings.data === undefined) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the estimate" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mx-auto h-[420px] w-full max-w-[210mm]" />
      </div>
    );
  }
  const initial: EstimateDraft = isNew
    ? emptyEstimateDraft(toDateParam(new Date()), {
        ...(searchParams.get('deal') ? { dealId: searchParams.get('deal') } : {}),
        ...(searchParams.get('company') ? { companyId: searchParams.get('company') } : {}),
        ...(searchParams.get('party') ? { partyId: searchParams.get('party') } : {}),
        // An estimate is an offer for a while: thirty days unless the salesperson says otherwise.
        validUntil: toDateParam(addDays(new Date(), 30)),
        terms: settings.data.designs.ESTIMATE.defaultTerms,
      })
    : estimateToDraft(record.data as Estimate);
  return (
    <EstimateEditor
      key={isNew ? 'new' : (record.data as Estimate).id}
      initial={initial}
      record={isNew ? null : (record.data as Estimate)}
      savedSettings={settings.data}
      logoUrl={branding.data?.logoUrl ?? null}
      orgName={branding.data?.name ?? ''}
    />
  );
}

function EstimateEditor({ initial, record, savedSettings, logoUrl, orgName }: { initial: EstimateDraft; record: Estimate | null; savedSettings: DocumentSettings; logoUrl: string | null; orgName: string }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState<EstimateDraft>(initial);
  const [preview, setPreview] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DocumentSettings>(savedSettings);
  const [settingsBase, setSettingsBase] = useState<DocumentSettings>(savedSettings);
  if (settingsBase !== savedSettings) {
    // The server's copy moved (someone saved elsewhere): adopt it unless this rail has unsaved edits.
    setSettingsBase(savedSettings);
    if (JSON.stringify(settingsDraft) === JSON.stringify(settingsBase)) setSettingsDraft(savedSettings);
  }
  const save = useSaveEstimate();
  const setStatus = useSetEstimateStatus();
  const remove = useDeleteEstimate();
  const convert = useConvertEstimate();
  const saveSettings = useSaveDocumentSettings();
  const canSeeParties = usePermission(PERMISSIONS.MASTERS_TALLY_VIEW);
  const canSeeCompanies = usePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF);
  const canManageSettings = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const canCreate = usePermission(PERMISSIONS.SALES_DOCUMENT_CREATE);
  const parties = useParties({ page: 1 }, { enabled: canSeeParties });
  const companies = useCompanyOptions({ enabled: canSeeCompanies });
  const items = useStockItems({ page: 1 }, { enabled: canSeeParties });

  const isNew = record === null;
  const editable = canCreate && draft.status === 'DRAFT' && !preview;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(savedSettings);
  const design = settingsDraft.designs.ESTIMATE;

  const partyOptions: PickerOption[] = (parties.data?.data ?? []).map((p) => ({ id: p.id, label: p.name, ...(p.gstin === null ? {} : { hint: p.gstin }) }));
  const companyOptions: PickerOption[] = (companies.data ?? []).map((c) => ({ id: c.id, label: c.name, ...(c.city === null ? {} : { hint: c.city }) }));
  const itemOptions = (items.data?.data ?? []).map((i) => ({
    id: i.id,
    label: i.name,
    hint: [i.unit, i.salePrice === null || i.salePrice === undefined ? null : `@ ${i.salePrice}`].filter((p): p is string => p !== null).join(' '),
    unit: i.unit,
    salePrice: i.salePrice ?? null,
    gstRate: i.gstRate,
  }));
  const pick = (options: PickerOption[], id: string | null) => options.find((o) => o.id === id) ?? null;
  const party = (parties.data?.data ?? []).find((p) => p.id === draft.partyId) ?? null;
  const presetName = pick(partyOptions, draft.partyId)?.label ?? pick(companyOptions, draft.companyId)?.label ?? null;
  const customerName = draft.customerName.trim() === '' && presetName !== null ? presetName : draft.customerName;
  const effectiveDraft: EstimateDraft = customerName === draft.customerName ? draft : { ...draft, customerName };
  const customerMissing = draft.partyId === null && draft.companyId === null && customerName.trim() === '';

  // Lines as the paper reads them: the server's figures when nothing changed, the preview while typing.
  const serverLines = record !== null && !dirty ? record.lines : null;
  const paperLines: PaperLine[] = draft.lines.map((line, index) => {
    const priced = serverLines?.[index] ?? null;
    const p = previewLine(line);
    return {
      key: line.key,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      discountPct: line.discountPct,
      taxPct: line.taxPct,
      amount: priced?.amount ?? (p === null ? null : p.amount.toFixed(2)),
      taxAmount: priced?.taxAmount ?? (p === null ? null : p.tax.toFixed(2)),
    };
  });
  const totals = (() => {
    if (serverLines !== null && record !== null) return { subtotal: record.subtotal, discountTotal: record.discountTotal, taxTotal: record.taxTotal, grandTotal: record.grandTotal, preview: false };
    let gross = 0;
    let net = 0;
    let tax = 0;
    for (const line of draft.lines) {
      const p = previewLine(line);
      if (p === null) continue;
      const qty = Number(line.quantity);
      const rate = Number(line.rate);
      gross += qty * rate;
      net += p.amount;
      tax += p.tax;
    }
    return { subtotal: net.toFixed(2), discountTotal: Math.max(0, gross - net).toFixed(2), taxTotal: tax.toFixed(2), grandTotal: (net + tax).toFixed(2), preview: true };
  })();

  const model: PaperModel = {
    type: 'ESTIMATE',
    number: record?.number ?? null,
    statusLabel: SALES_DOCUMENT_STATUS_LABELS[draft.status],
    date: draft.date,
    validUntil: draft.validUntil,
    customerName,
    customerDetail: party === null ? null : [party.gstin ? `GSTIN ${party.gstin}` : null, party.address].filter((p): p is string => p !== null && p !== '').join('\n'),
    reference: null,
    lines: paperLines,
    totals,
    notes: draft.notes,
    terms: draft.terms,
  };

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  }
  function chooseItem(key: string, option: PickerOption | null) {
    const item = itemOptions.find((i) => i.id === option?.id);
    updateLine(key, {
      stockItemId: item?.id ?? null,
      description: item?.label ?? '',
      unit: item?.unit ?? '',
      rate: item?.salePrice === null || item?.salePrice === undefined ? '' : item.salePrice.replace(/\.?0+$/u, ''),
      taxPct: item?.gstRate === null || item?.gstRate === undefined ? '0' : String(Number(item.gstRate)),
    });
  }
  const editing: PaperEditing | undefined = editable
    ? {
        customer: (
          <div className="flex flex-col gap-1">
            <div className="grid gap-1 sm:grid-cols-2">
              <RecordPicker
                id="estimate-party"
                label="Tally party"
                placeholder="Tally party"
                searchPlaceholder="Search parties"
                emptyMessage="No party matches. A prospect is a CRM company until it buys (REQ-U-03)."
                icon={<BooksIcon className="text-muted-foreground" />}
                options={partyOptions}
                loading={parties.isPending}
                disabled={!canSeeParties}
                clearable
                clearLabel="No party"
                value={pick(partyOptions, draft.partyId)}
                onValueChange={(next) => {
                  setDraft((current) => ({ ...current, partyId: next?.id ?? null, companyId: next === null ? current.companyId : null, customerName: next?.label ?? current.customerName }));
                }}
              />
              <RecordPicker
                id="estimate-company"
                label="CRM company"
                placeholder="or a CRM company"
                searchPlaceholder="Search companies"
                emptyMessage="No company matches."
                icon={<BuildingsIcon className="text-muted-foreground" />}
                options={companyOptions}
                loading={companies.isPending}
                disabled={!canSeeCompanies || draft.partyId !== null}
                clearable
                clearLabel="No company"
                value={pick(companyOptions, draft.companyId)}
                onValueChange={(next) => {
                  setDraft((current) => ({ ...current, companyId: next?.id ?? null, customerName: next?.label ?? current.customerName }));
                }}
              />
            </div>
            <PaperField label="Addressed to" value={customerName} placeholder="Addressed to" className="text-[1.05em] font-semibold" onChange={(value) => { setDraft((current) => ({ ...current, customerName: value })); }} />
          </div>
        ),
        date: (
          <DateField label="Estimate date" value={fromDateParam(draft.date)} onValueChange={(next) => { setDraft((current) => ({ ...current, date: toDateParam(next) })); }} yearsBack={1} yearsForward={1} className="paper-field h-auto min-h-0 px-0 py-0 shadow-none" />
        ),
        validUntil: (
          <DateField label="Valid until" value={draft.validUntil ? fromDateParam(draft.validUntil) : new Date()} onValueChange={(next) => { setDraft((current) => ({ ...current, validUntil: toDateParam(next) })); }} yearsBack={0} yearsForward={2} className="paper-field h-auto min-h-0 px-0 py-0 shadow-none" />
        ),
        itemPicker: (line) => {
          const draftLine = draft.lines.find((l) => l.key === line.key);
          return canSeeParties ? (
            <RecordPicker
              id={`estimate-line-item-${line.key}`}
              label="Stock item"
              placeholder="Stock item, or type a description"
              searchPlaceholder="Search stock items"
              emptyMessage="No item matches. Leave it and type a description."
              options={itemOptions}
              loading={items.isPending}
              clearable
              clearLabel="No stock item"
              value={itemOptions.find((o) => o.id === draftLine?.stockItemId) ?? null}
              onValueChange={(next) => {
                chooseItem(line.key, next);
              }}
            />
          ) : null;
        },
        updateLine: (key, patch) => {
          updateLine(key, patch);
        },
        addLine: () => {
          setDraft((current) => ({ ...current, lines: [...current.lines, newLine()] }));
        },
        removeLine: (key) => {
          setDraft((current) => ({ ...current, lines: current.lines.length === 1 ? [newLine()] : current.lines.filter((line) => line.key !== key) }));
        },
        setNotes: (value) => {
          setDraft((current) => ({ ...current, notes: value }));
        },
        setTerms: (value) => {
          setDraft((current) => ({ ...current, terms: value }));
        },
      }
    : undefined;

  function submit() {
    if (customerMissing || save.isPending || !editable) return;
    save.mutate(effectiveDraft, {
      onSuccess: (saved) => {
        toast.add({ type: 'success', title: isNew ? `${saved.number} raised` : `${saved.number} saved`, description: `${saved.customerName} · ${formatMoney(saved.grandTotal)}` });
        if (isNew) void navigate(`/sales/estimates/${saved.id}`, { replace: true });
      },
    });
  }
  function move(status: EstimateStatus) {
    if (record === null) return;
    setStatus.mutate({ id: record.id, status }, { onSuccess: (saved) => { toast.add({ type: 'success', title: `${saved.number} ${SALES_DOCUMENT_STATUS_LABELS[saved.status].toLowerCase()}` }); } });
  }
  function persistSettings() {
    saveSettings.mutate(settingsDraft, {
      onSuccess: () => {
        toast.add({ type: 'success', title: 'Design saved', description: 'Every estimate prints this way now.' });
      },
    });
  }
  async function exportXlsx() {
    if (record === null) return;
    try {
      await downloadDocumentFile(`/sales/estimates/${record.id}/export.xlsx`, `Estimate-${record.number}.xlsx`);
    } catch (error) {
      toast.add({ type: 'error', title: 'Excel export failed', description: error instanceof Error ? error.message : 'Try again.' });
    }
  }

  const failure = save.error ?? setStatus.error ?? remove.error ?? convert.error;
  const copy = actionErrorCopy(failure, save.error ? 'Saving the estimate' : convert.error ? 'Converting the estimate' : 'Changing the estimate');
  const transitions = record === null || !isEstimateStatus(record.status) ? [] : ESTIMATE_TRANSITIONS[record.status];
  const busy = save.isPending || setStatus.isPending || remove.isPending || convert.isPending;

  const rail = (
    <DesignRail
      docType="ESTIMATE"
      settings={settingsDraft}
      onChange={setSettingsDraft}
      canSave={canManageSettings}
      dirty={settingsDirty}
      saving={saveSettings.isPending}
      saveError={saveSettings.error}
      onSave={persistSettings}
      onDiscard={() => {
        setSettingsDraft(savedSettings);
      }}
    />
  );

  return (
    <ShortcutLayer id={`screen:estimate-editor-${record?.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />
      <div className="-mx-4 -mt-4 flex min-h-[calc(100dvh-3.5rem)] flex-col md:-mx-6 md:-mt-6">
        {/* The bar: where you are, what this is, what you can do — the paper below is the page. */}
        <div className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-4 py-2 backdrop-blur md:px-6">
          <Button variant="ghost" size="sm" render={<Link to="/sales/estimates" />}>
            <ArrowLeftIcon data-icon="inline-start" />
            Estimates
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{isNew ? 'New estimate' : `Estimate ${record.number}`}</span>
            <Badge variant="outline">{SALES_DOCUMENT_STATUS_LABELS[draft.status]}</Badge>
            {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {record !== null && transitions.length > 0 && !dirty ? (
              <Select value={record.status} onValueChange={(value: string | null) => { if (value !== null && isEstimateStatus(value) && value !== record.status) move(value); }}>
                <SelectTrigger className="pointer-coarse:min-h-11 w-40" aria-label="Status" disabled={busy}>
                  <SelectValue>{(value: string) => (isEstimateStatus(value) ? SALES_DOCUMENT_STATUS_LABELS[value] : value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={record.status}>{SALES_DOCUMENT_STATUS_LABELS[record.status]}</SelectItem>
                  {transitions.map((next) => (
                    <SelectItem key={next} value={next}>
                      {SALES_DOCUMENT_STATUS_LABELS[next]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button variant={preview ? 'default' : 'outline'} size="sm" aria-pressed={preview} onClick={() => { setPreview((v) => !v); }}>
              {preview ? <PencilSimpleIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
              {preview ? 'Edit' : 'Preview'}
            </Button>
            <Button variant="outline" size="sm" disabled={record === null} render={record === null ? undefined : <a href={`/print/estimates/${record.id}`} target="_blank" rel="noreferrer" />}>
              <PrinterIcon data-icon="inline-start" />
              PDF
            </Button>
            <Button variant="outline" size="sm" disabled={record === null} onClick={() => { void exportXlsx(); }}>
              <FileXlsIcon data-icon="inline-start" />
              Excel
            </Button>
            <Button variant="outline" size="sm" className="lg:hidden" aria-label="Open the design rail" onClick={() => { setDesignOpen(true); }}>
              <PaintBrushIcon data-icon="inline-start" />
              Design
            </Button>
            {record !== null && record.status === 'ACCEPTED' && canCreate ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { convert.mutate({ estimateId: record.id }, { onSuccess: (order) => { toast.add({ type: 'success', title: `${order.number} raised from ${record.number}` }); void navigate(`/sales/orders/${order.id}`); } }); }}>
                <ArrowRightIcon data-icon="inline-start" />
                Sales order
              </Button>
            ) : null}
            {record !== null && record.status === 'DRAFT' && canCreate ? (
              confirmDelete ? (
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => { remove.mutate(record.id, { onSuccess: () => { toast.add({ type: 'success', title: `${record.number} deleted` }); void navigate('/sales/estimates'); } }); }}>
                  <TrashIcon data-icon="inline-start" />
                  Delete for sure
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setConfirmDelete(true); }}>
                  <TrashIcon data-icon="inline-start" />
                  Delete
                </Button>
              )
            ) : null}
            {editable ? (
              <Button size="sm" aria-label="Save estimate" disabled={busy || customerMissing || !dirty} onClick={submit}>
                {save.isPending ? <Spinner data-icon="inline-start" /> : <ACTION_ICONS.save data-icon="inline-start" />}
                {save.isPending ? 'Saving' : 'Save'}
                <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="bg-muted/40 min-w-0 flex-1 overflow-y-auto px-3 py-6 md:px-8">
            {failure ? (
              <Alert variant="destructive" className="mx-auto mb-4 max-w-[210mm]">
                <WarningCircleIcon />
                <AlertTitle>{copy.title}</AlertTitle>
                <AlertDescription>{copy.description}</AlertDescription>
              </Alert>
            ) : null}
            {customerMissing && editable ? <p className="text-muted-foreground mx-auto mb-3 max-w-[210mm] text-xs">Choose a Tally party or a CRM company, or type who it is addressed to.</p> : null}
            <div className="mx-auto max-w-[210mm]">
              <DocumentPaper design={design} profile={settingsDraft.profile} logoUrl={logoUrl} orgName={orgName} model={model} editing={editing} />
            </div>
          </div>
          <aside className="hidden w-80 shrink-0 border-l lg:block">{rail}</aside>
        </div>
      </div>

      <Sheet open={designOpen} onOpenChange={setDesignOpen}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 p-0 sm:max-w-md max-md:max-h-[92vh]">
          <SheetHeader className="border-b">
            <SheetTitle>Design</SheetTitle>
            <SheetDescription>Template, accent and what the page shows.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{rail}</div>
        </SheetContent>
      </Sheet>
    </ShortcutLayer>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({ id: 'estimate-editor.save', keys: 'ctrl+a', label: 'Accept / Save', scope: 'screen', allowInInput: true, run: onSave });
  return null;
}
