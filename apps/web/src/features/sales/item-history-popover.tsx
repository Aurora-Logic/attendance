import { useState } from 'react';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate, formatRelativeAge } from '@/lib/format';

import { useItemHistory } from './use-estimates';

/**
 * REQ-W-02: "on selecting an item in an estimate, an information affordance
 * opens that item's history for that party". A popover on a desktop, a
 * bottom sheet on a phone (CLAUDE.md §3), asked when opened — the reason
 * the backfill is worth its cost, one click from the rate box.
 */
export function ItemHistoryAffordance({
  stockItemId,
  partyId,
  companyId,
  disabled,
}: {
  stockItemId: string | null;
  partyId: string | null;
  companyId: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const history = useItemHistory({ stockItemId, partyId, companyId, enabled: open });

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Item history for this customer"
      disabled={disabled === true || stockItemId === null}
      title="What this customer was quoted and invoiced for this item"
    >
      <ClockCounterClockwiseIcon />
    </Button>
  );

  const body = (
    <div className="flex flex-col gap-2 text-sm">
      {history.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading item history" className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ) : null}
      {history.isError ? <p className="text-muted-foreground">Could not load the history: {history.error.message}</p> : null}
      {history.isSuccess ? (
        <>
          <p className="text-muted-foreground text-xs">
            Current sale price {history.data.currentSalePrice ?? EMPTY_VALUE}
            {history.data.vouchersAsOf === null ? '' : ` · vouchers as of ${formatRelativeAge(history.data.vouchersAsOf)}`}
          </p>
          {history.data.entries.length === 0 ? (
            <p className="text-muted-foreground">
              {partyId === null && companyId === null ? 'Choose a customer to see their history with this item.' : 'Nothing quoted or invoiced for this customer yet.'}
            </p>
          ) : (
            <ul className="divide-y border">
              {history.data.entries.map((entry, index) => (
                <li key={`${entry.reference}-${String(index)}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{entry.reference}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {formatDate(entry.date)}
                      {entry.status === null ? '' : ` · ${entry.status}`}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {[entry.quantity, entry.rate === null ? null : `@ ${entry.rate}`, entry.discountPct === null || entry.discountPct === '0.00' ? null : `−${entry.discountPct}%`, entry.amount === null ? null : `= ${entry.amount}`]
                      .filter((p): p is string => p !== null)
                      .join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader className="border-b">
            <SheetTitle>{history.data?.stockItemName ?? 'Item history'}</SheetTitle>
            <SheetDescription>What this customer was quoted and invoiced for this item.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-96 max-w-[90vw]">
        <PopoverHeader>
          <PopoverTitle>{history.data?.stockItemName ?? 'Item history'}</PopoverTitle>
          <PopoverDescription>What this customer was quoted and invoiced for this item.</PopoverDescription>
        </PopoverHeader>
        <div className="mt-2">{body}</div>
      </PopoverContent>
    </Popover>
  );
}
