import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, ArrowsInIcon, DotsThreeVerticalIcon, EyeIcon, FileXlsIcon, PaintBrushIcon, PencilSimpleIcon, PrinterIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBranding } from '@/lib/branding/use-branding';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import { PERMISSIONS, type DocumentSettings, type PrintedDocumentType } from '@vyuha/shared';

import { DesignRail } from './design-rail';
import { downloadDocumentFile } from './download';
import { DocumentPaper, type PaperEditing, type PaperModel } from './paper';
import { useFooterLogoUrls, useSaveDocumentSettings } from './use-document-settings';

/**
 * The page every printed document is edited on: a bar (where you are, what
 * this is, what you can do), the stage with the paper zoomed to fit the
 * screen, Preview, PDF, Excel, and the design rail on request. The
 * document types differ in what they hold and what they can do — the
 * estimate, order, invoice and purchase order pages hand this shell their
 * paper model, their editing hooks and their own action buttons; the
 * shell owns everything the four have in common, so a person who has
 * raised one document knows how to raise the others.
 */

/** 210mm at CSS pixels. */
const A4_WIDTH_PX = 794;

/** Zoom steps the fit chooses from — classes, not a computed transform, so nothing is styled inline. */
const ZOOMS = [
  { value: 0.4, className: '[zoom:0.4]' },
  { value: 0.45, className: '[zoom:0.45]' },
  { value: 0.55, className: '[zoom:0.55]' },
  { value: 0.65, className: '[zoom:0.65]' },
  { value: 0.75, className: '[zoom:0.75]' },
  { value: 0.85, className: '[zoom:0.85]' },
  { value: 1, className: '[zoom:1]' },
] as const;

export interface DocumentEditorProps {
  docType: PrintedDocumentType;
  /** Where the back arrow goes and what it says. */
  backTo: string;
  backLabel: string;
  /** "New estimate", "Sales order SO-0007". */
  title: string;
  /** Badges after the title: status, sync state, fulfilment. */
  badges?: ReactNode;
  dirty: boolean;
  /** Buttons after Preview / PDF / Excel / Design; the page's own verbs, Save last. */
  actions?: ReactNode;
  /** An error the page wants shown above the paper. */
  failure?: { title: string; description: string } | null;
  /** A one-line hint above the paper (what is missing before Save). */
  hint?: string | null;
  model: PaperModel;
  /** Present while the document is editable and Preview is off. */
  editing?: PaperEditing;
  /** Turned off while the document is not editable, so Preview does not pretend to toggle anything. */
  canPreview?: boolean;
  /** Paths for the print route and the Excel copy; null while unsaved. */
  printPath: string | null;
  excel: { path: string; filename: string } | null;
  /** Anything below the paper: quantities, invoices, dispatches, receipts. */
  extras?: ReactNode;
  /** The design draft is the page's, so the paper and the rail see one copy. */
  settings: { draft: DocumentSettings; setDraft: (next: DocumentSettings) => void; saved: DocumentSettings };
}

export function DocumentEditor(props: DocumentEditorProps) {
  const { docType, backTo, backLabel, title, badges, dirty, actions, failure, hint, model, editing, canPreview = true, printPath, excel, extras, settings } = props;
  const isMobile = useIsMobile();
  const branding = useBranding();
  const [preview, setPreview] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [fit, setFit] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(ZOOMS.length - 1);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const saveSettings = useSaveDocumentSettings();
  const canManageSettings = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const footerLogoUrls = useFooterLogoUrls(settings.draft.profile.footerLogoFileIds);
  const design = settings.draft.designs[docType];
  const settingsDirty = JSON.stringify(settings.draft) !== JSON.stringify(settings.saved);
  const showEditing = preview ? undefined : editing;
  const hasExtras = extras !== undefined;

  // Fit: the largest zoom step at which the whole sheet stands in the stage — by height on a desk; by width on a
  // phone, where the stage scrolls and a squashed A4 grid would be unreadable.
  useLayoutEffect(() => {
    if (!fit) return undefined;
    const stage = stageRef.current;
    const paper = paperRef.current;
    if (stage === null || paper === null) return undefined;
    const measure = () => {
      const availableHeight = stage.clientHeight - 32;
      const availableWidth = stage.clientWidth - (isMobile ? 24 : 32);
      const current = ZOOMS[zoomIndex]?.value ?? 1;
      const rect = paper.getBoundingClientRect();
      const naturalHeight = rect.height / current;
      // The sheet is 210mm wide unless the stage has squashed it, so the width is known rather than measured.
      const naturalWidth = A4_WIDTH_PX;
      if (naturalHeight === 0 || availableWidth <= 0) return;
      const byHeight = !isMobile;
      const byWidth = isMobile;
      let index = 0;
      for (let i = ZOOMS.length - 1; i >= 0; i -= 1) {
        const step = ZOOMS[i];
        if (step !== undefined && (!byHeight || naturalHeight * step.value <= availableHeight) && (!byWidth || naturalWidth * step.value <= availableWidth)) {
          index = i;
          break;
        }
      }
      setZoomIndex((prev) => (prev === index ? prev : index));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, [fit, isMobile, zoomIndex, design.templateId, design.fontScale, model.lines.length, hasExtras]);

  async function exportXlsx() {
    if (excel === null) return;
    try {
      await downloadDocumentFile(excel.path, excel.filename);
    } catch (error) {
      toast.add({ type: 'error', title: 'Excel export failed', description: error instanceof Error ? error.message : 'Try again.' });
    }
  }
  const zoom = ZOOMS[fit ? zoomIndex : ZOOMS.length - 1];

  return (
    <>
      <div className="-mx-4 -mt-4 -mb-24 flex h-[calc(100dvh-3.5rem)] flex-col md:-mx-6 md:-mt-6 md:-mb-6">
        <div className="bg-background/85 supports-[backdrop-filter]:bg-background/70 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 backdrop-blur md:px-6">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={backTo} />}>
            <ArrowLeftIcon data-icon="inline-start" />
            {backLabel}
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {badges}
            {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant={fit ? 'default' : 'outline'} size="sm" className="hidden md:inline-flex" aria-pressed={fit} aria-label="Fit the page to the screen" onClick={() => { setFit((v) => !v); }}>
              <ArrowsInIcon data-icon="inline-start" />
              {fit ? `Fit ${String(Math.round(zoom.value * 100))}%` : '100%'}
            </Button>
            {canPreview && editing !== undefined ? (
              <Button variant={preview ? 'default' : 'outline'} size="sm" aria-pressed={preview} onClick={() => { setPreview((v) => !v); }}>
                {preview ? <PencilSimpleIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
                {preview ? 'Edit' : 'Preview'}
              </Button>
            ) : null}
            <div className="hidden items-center gap-2 md:flex">
              {/* An anchor, so the print route opens in its own tab; nativeButton off because the rendered element is not a <button>. */}
              {printPath === null ? (
                <Button variant="outline" size="sm" disabled>
                  <PrinterIcon data-icon="inline-start" />
                  PDF
                </Button>
              ) : (
                <Button variant="outline" size="sm" nativeButton={false} render={<a href={printPath} target="_blank" rel="noreferrer" />}>
                  <PrinterIcon data-icon="inline-start" />
                  PDF
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={excel === null} onClick={() => { void exportXlsx(); }}>
                <FileXlsIcon data-icon="inline-start" />
                Excel
              </Button>
              <Button variant="outline" size="sm" aria-label="Open the design rail" onClick={() => { setDesignOpen(true); }}>
                <PaintBrushIcon data-icon="inline-start" />
                Design
              </Button>
              {isMobile ? null : actions}
            </div>
            {/* On a phone the bar stays one row: Preview beside an overflow that
                opens as a bottom sheet (thumb-reach: a menu of rows arrives from
                an edge); the page's own verbs move to a footer the thumb reaches. */}
            <Button variant="outline" size="icon-sm" className="pointer-coarse:size-11 md:hidden" aria-label="More document actions" onClick={() => { setMobileMenuOpen(true); }}>
              <DotsThreeVerticalIcon />
            </Button>
          </div>
        </div>

        <div ref={stageRef} className="bg-muted/40 min-h-0 flex-1 overflow-auto px-3 py-4 md:px-6">
          {failure ? (
            <Alert variant="destructive" className="mx-auto mb-4 max-w-[210mm]">
              <WarningCircleIcon />
              <AlertTitle>{failure.title}</AlertTitle>
              <AlertDescription>{failure.description}</AlertDescription>
            </Alert>
          ) : null}
          {hint ? <p className="text-muted-foreground mx-auto mb-3 max-w-[210mm] text-xs">{hint}</p> : null}
          <div ref={paperRef} className={cn('mx-auto w-fit max-w-full', zoom.className)}>
            <DocumentPaper design={design} profile={settings.draft.profile} logoUrl={branding.data?.logoUrl ?? null} footerLogoUrls={footerLogoUrls} orgName={branding.data?.name ?? ''} model={model} editing={showEditing} />
          </div>
          {extras ? <div className="mx-auto mt-6 max-w-[210mm]">{extras}</div> : null}
        </div>

        {isMobile && actions !== undefined && actions !== null ? (
          <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
            {actions}
          </div>
        ) : null}
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="bottom" className="gap-0">
          <SheetHeader className="border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Export and design.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {printPath === null ? (
              <Button variant="outline" className="justify-start" disabled>
                <PrinterIcon data-icon="inline-start" />
                PDF
              </Button>
            ) : (
              <Button variant="outline" className="justify-start" nativeButton={false} render={<a href={printPath} target="_blank" rel="noreferrer" />} onClick={() => { setMobileMenuOpen(false); }}>
                <PrinterIcon data-icon="inline-start" />
                PDF
              </Button>
            )}
            <Button variant="outline" className="justify-start" disabled={excel === null} onClick={() => { void exportXlsx(); setMobileMenuOpen(false); }}>
              <FileXlsIcon data-icon="inline-start" />
              Excel
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => { setMobileMenuOpen(false); setDesignOpen(true); }}>
              <PaintBrushIcon data-icon="inline-start" />
              Design
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={designOpen} onOpenChange={setDesignOpen}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 p-0 sm:max-w-md max-md:max-h-[92vh]">
          <SheetHeader className="border-b">
            <SheetTitle>Design</SheetTitle>
            <SheetDescription>Template, accent and what the page shows — live on the paper. Business details are saved once, for every document.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <DesignRail
              docType={docType}
              settings={settings.draft}
              onChange={settings.setDraft}
              canSave={canManageSettings}
              dirty={settingsDirty}
              saving={saveSettings.isPending}
              saveError={saveSettings.error}
              onSave={() => {
                saveSettings.mutate(settings.draft, {
                  onSuccess: () => {
                    toast.add({ type: 'success', title: 'Design saved', description: 'Every document of this kind prints this way now.' });
                  },
                });
              }}
              onDiscard={() => {
                settings.setDraft(settings.saved);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

