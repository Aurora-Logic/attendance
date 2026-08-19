import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, ArrowsInIcon, EyeIcon, FileXlsIcon, ListBulletsIcon, PaintBrushIcon, PencilSimpleIcon, PrinterIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBranding } from '@/lib/branding/use-branding';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import { PERMISSIONS, type DocumentSettings, type PrintedDocumentType } from '@vyuha/shared';

import { DesignRail } from './design-rail';
import { DocumentForm } from './document-form';
import { downloadDocumentFile } from './download';
import { DocumentPaper, type PaperEditing, type PaperModel } from './paper';
import { useFooterLogoUrls, useSaveDocumentSettings } from './use-document-settings';

/**
 * The page every printed document is edited on: a bar (where you are, what
 * this is, what you can do), the stage, PDF, Excel, and the design rail on
 * request. Two ways in, one draft: **Form** — a plain form top to bottom
 * with the paper filling in beside it on a wide screen — and **Paper** —
 * the fields typed where they print; **Preview** is the paper read-only.
 * The last choice is remembered on this device. The document types differ
 * in what they hold and what they can do — the estimate, order, invoice
 * and purchase order pages hand this shell their paper model, their
 * editing hooks and their own action buttons; the shell owns everything
 * the four have in common, so a person who has raised one document knows
 * how to raise the others.
 */

type EditorMode = 'form' | 'paper' | 'preview';
const MODE_KEY = 'vyuha.documents.editorMode';

function rememberedMode(): EditorMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === 'paper' || stored === 'form' ? stored : 'form';
  } catch {
    return 'form';
  }
}

/** Zoom steps the fit chooses from — classes, not a computed transform, so nothing is styled inline. */
const ZOOMS = [
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
  const [mode, setModeState] = useState<EditorMode>(rememberedMode);
  const setMode = (next: EditorMode) => {
    setModeState(next);
    // Preview is a glance, not a preference; only the two ways of editing are remembered.
    if (next !== 'preview') {
      try {
        window.localStorage.setItem(MODE_KEY, next);
      } catch {
        // A locked-down browser forgets; the page still works.
      }
    }
  };
  const [designOpen, setDesignOpen] = useState(false);
  const [fit, setFit] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(ZOOMS.length - 1);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const saveSettings = useSaveDocumentSettings();
  const canManageSettings = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const footerLogoUrls = useFooterLogoUrls(settings.draft.profile.footerLogoFileIds);
  const design = settings.draft.designs[docType];
  const settingsDirty = JSON.stringify(settings.draft) !== JSON.stringify(settings.saved);
  // A read-only document has one view: the paper.
  const editable = editing !== undefined && canPreview;
  const effectiveMode: EditorMode = editing === undefined ? 'preview' : mode;
  const formMode = effectiveMode === 'form';
  const showEditing = effectiveMode === 'paper' ? editing : undefined;
  const hasExtras = extras !== undefined;

  // Fit: the largest zoom step at which the whole sheet stands in the stage — by height, and beside the form by width too.
  useLayoutEffect(() => {
    if (!fit || isMobile) return undefined;
    const stage = stageRef.current;
    const paper = paperRef.current;
    if (stage === null || paper === null) return undefined;
    const measure = () => {
      const availableHeight = stage.clientHeight - 32;
      const availableWidth = stage.clientWidth - 32;
      const current = ZOOMS[zoomIndex]?.value ?? 1;
      const rect = paper.getBoundingClientRect();
      const naturalHeight = rect.height / current;
      const naturalWidth = rect.width / current;
      if (naturalHeight === 0 || availableHeight <= 0) return;
      let index = 0;
      for (let i = ZOOMS.length - 1; i >= 0; i -= 1) {
        const step = ZOOMS[i];
        if (step !== undefined && naturalHeight * step.value <= availableHeight && (!formMode || naturalWidth * step.value <= availableWidth)) {
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
  }, [fit, isMobile, zoomIndex, design.templateId, design.fontScale, model.lines.length, hasExtras, formMode]);

  async function exportXlsx() {
    if (excel === null) return;
    try {
      await downloadDocumentFile(excel.path, excel.filename);
    } catch (error) {
      toast.add({ type: 'error', title: 'Excel export failed', description: error instanceof Error ? error.message : 'Try again.' });
    }
  }
  const zoom = isMobile ? ZOOMS[ZOOMS.length - 1] : ZOOMS[fit ? zoomIndex : ZOOMS.length - 1];

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
            {editable ? (
              <ToggleGroup
                variant="outline"
                aria-label="How to edit"
                value={[effectiveMode]}
                onValueChange={(value: string[]) => {
                  const next = value[0];
                  if (next === 'form' || next === 'paper' || next === 'preview') setMode(next);
                }}
              >
                <ToggleGroupItem value="form" aria-label="Form" className="pointer-coarse:min-h-11 px-2.5">
                  <ListBulletsIcon data-icon="inline-start" />
                  Form
                </ToggleGroupItem>
                <ToggleGroupItem value="paper" aria-label="Paper" className="pointer-coarse:min-h-11 px-2.5">
                  <PencilSimpleIcon data-icon="inline-start" />
                  Paper
                </ToggleGroupItem>
                <ToggleGroupItem value="preview" aria-label="Preview" className="pointer-coarse:min-h-11 px-2.5">
                  <EyeIcon data-icon="inline-start" />
                  Preview
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
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
            {actions}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {formMode && editing !== undefined ? (
            <div className="min-h-0 w-full overflow-y-auto px-4 py-4 md:px-6 xl:w-[min(100%,42rem)] xl:shrink-0 xl:border-r">
              {failure ? (
                <Alert variant="destructive" className="mb-4">
                  <WarningCircleIcon />
                  <AlertTitle>{failure.title}</AlertTitle>
                  <AlertDescription>{failure.description}</AlertDescription>
                </Alert>
              ) : null}
              {hint ? <p className="text-muted-foreground mb-3 text-xs">{hint}</p> : null}
              <DocumentForm model={model} editing={editing} design={design} />
              {extras ? <div className="mt-6">{extras}</div> : null}
            </div>
          ) : null}
          {/* Beside the form the paper is a live preview on a wide screen only; on its own it is the stage. */}
          <div ref={stageRef} className={cn('bg-muted/40 min-h-0 flex-1 overflow-auto px-3 py-4 md:px-6', formMode && 'max-xl:hidden')}>
            {!formMode && failure ? (
              <Alert variant="destructive" className="mx-auto mb-4 max-w-[210mm]">
                <WarningCircleIcon />
                <AlertTitle>{failure.title}</AlertTitle>
                <AlertDescription>{failure.description}</AlertDescription>
              </Alert>
            ) : null}
            {!formMode && hint ? <p className="text-muted-foreground mx-auto mb-3 max-w-[210mm] text-xs">{hint}</p> : null}
            <div ref={paperRef} className={cn('mx-auto w-fit max-w-full', zoom.className)}>
              <DocumentPaper design={design} profile={settings.draft.profile} logoUrl={branding.data?.logoUrl ?? null} footerLogoUrls={footerLogoUrls} orgName={branding.data?.name ?? ''} model={model} editing={showEditing} />
            </div>
            {!formMode && extras ? <div className="mx-auto mt-6 max-w-[210mm]">{extras}</div> : null}
          </div>
        </div>
      </div>

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

