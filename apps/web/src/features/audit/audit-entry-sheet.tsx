import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

import { AuditEntryDetail } from './audit-entry-detail';
import { actorLabel, printInstant } from './format';
import { humaniseAction, type AuditEntry } from './types';

/**
 * One audit entry, opened from a row of the viewer (REQ-M-02).
 *
 * Bottom on a phone, right on a desktop: a surface should arrive from the edge
 * nearest the hand that opened it (CLAUDE.md §3 rule 1).
 */
export function AuditEntrySheet({
  entry,
  onOpenChange,
}: {
  /** Null closes the sheet, so open state lives in one place. */
  entry: AuditEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {entry ? (
          <>
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle>{humaniseAction(entry.action)}</SheetTitle>
              <SheetDescription>
                {printInstant(entry.createdAt)} by {actorLabel(entry)}
              </SheetDescription>
            </SheetHeader>

            {/* min-h-0 is load-bearing: without it this flex child refuses to
                shrink below its content and scrolls the page instead of
                itself. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              <AuditEntryDetail entry={entry} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
