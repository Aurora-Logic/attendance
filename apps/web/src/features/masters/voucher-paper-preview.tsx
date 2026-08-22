import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowSquareOutIcon, FileXlsIcon, PrinterIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { downloadDocumentFile } from '@/features/documents/download';
import { DocumentPaper } from '@/features/documents/paper';
import { paperModelOf, voucherAsPaper } from '@/features/documents/paper-record';
import { useDocumentSettings, useFooterLogoUrls } from '@/features/documents/use-document-settings';
import { useParty } from '@/features/masters/use-parties';
import { useBranding } from '@/lib/branding/use-branding';
import type { VoucherDetailView } from '@vyuha/shared';

/**
 * The voucher on the organisation's paper, inside the voucher sheet
 * (owner, 22 Aug 2026: "I shall get the preview here"). The sheet is
 * narrow, so the A4 sheet is scaled to its width with a transform and the
 * box beneath is sized to the measured sheet times the scale, the way the
 * document editor fits its stage. PDF goes through the print route, Excel
 * through the export; the full editor (with the design rail) is one tap
 * away for anyone who wants it.
 */
const A4_WIDTH_PX = 794;

export function VoucherPaperPreview({ voucher }: { voucher: VoucherDetailView }) {
  const settings = useDocumentSettings();
  const branding = useBranding();
  const { type, record } = voucherAsPaper(voucher);
  const party = useParty(record.partyId);
  const footerLogoUrls = useFooterLogoUrls(settings.data?.profile.footerLogoFileIds ?? []);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const paper = paperRef.current;
    if (stage === null || paper === null) return undefined;
    const measure = () => {
      const width = stage.clientWidth;
      if (width > 0) setScale(Math.min(1, width / A4_WIDTH_PX));
      const natural = paper.offsetHeight;
      if (natural > 0) setSheetHeight((prev) => (prev === natural ? prev : natural));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(paper);
    return () => {
      observer.disconnect();
    };
  }, [settings.data, branding.data, party.data, voucher.id]);

  async function exportXlsx() {
    try {
      await downloadDocumentFile(`/masters/vouchers/${voucher.id}/export.xlsx`, `${(record.title ?? 'Voucher').replace(/\s+/gu, '-')}-${(voucher.voucherNumber || voucher.id.slice(-4)).replace(/[\\/]/gu, '-')}.xlsx`);
    } catch (error) {
      toast.add({ type: 'error', title: 'Excel export failed', description: error instanceof Error ? error.message : 'Try again.' });
    }
  }

  const ready = settings.data !== undefined && branding.data !== undefined && (record.partyId === null || party.data !== undefined || party.isError);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" nativeButton={false} render={<a href={`/print/vouchers/${voucher.id}`} target="_blank" rel="noreferrer" />}>
          <PrinterIcon data-icon="inline-start" />
          Print / PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void exportXlsx();
          }}
        >
          <FileXlsIcon data-icon="inline-start" />
          Excel
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to={`/masters/vouchers/${voucher.id}/paper`} />}>
          <ArrowSquareOutIcon data-icon="inline-start" />
          Full preview
        </Button>
      </div>
      {/* overflow-x-clip: the sheet keeps its A4 layout width under the transform. */}
      <div
        ref={stageRef}
        className="h-[var(--sheet-h)] overflow-x-clip"
        style={{ '--sheet-h': sheetHeight === null ? 'auto' : `${String(sheetHeight * scale)}px`, '--sheet-scale': String(scale) } as CSSProperties}
      >
        {ready ? (
          <div ref={paperRef} className="w-[210mm] origin-top-left scale-[var(--sheet-scale)]">
            <DocumentPaper
              design={settings.data.designs[type]}
              profile={settings.data.profile}
              logoUrl={branding.data.logoUrl}
              footerLogoUrls={footerLogoUrls}
              orgName={branding.data.name}
              model={paperModelOf(type, record, party.data)}
            />
          </div>
        ) : (
          <Skeleton className="h-72 w-full" aria-label="Preparing the paper" />
        )}
      </div>
    </div>
  );
}
