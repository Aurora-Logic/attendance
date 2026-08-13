import { ArrowCounterClockwiseIcon, SlidersHorizontalIcon } from '@phosphor-icons/react';

import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ReportColumnSpec } from '@vyuha/shared';

/**
 * F12, "configure current screen (columns, view)" (PRD §6.4).
 *
 * A popover on a desktop and a bottom Sheet on a phone, for the reason
 * CLAUDE.md §3 gives about pickers: a seventeen-item checklist in a popover
 * anchored to a toolbar button is unusable at 360px. The two surfaces have
 * different structure and dismissal, so this switches on `useIsMobile()`
 * rather than on a CSS breakpoint.
 *
 * The last visible column cannot be turned off. A table with no columns is not
 * a configuration anyone wants, and the alternative -- silently falling back
 * to the defaults -- would look like the checkbox not working.
 */

interface ColumnChooserProps {
  columns: readonly ReportColumnSpec[];
  visible: readonly string[];
  onVisibleChange: (next: string[]) => void;
  onReset: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ColumnChooser({
  columns,
  visible,
  onVisibleChange,
  onReset,
  open,
  onOpenChange,
}: ColumnChooserProps) {
  const isMobile = useIsMobile();
  const chosen = new Set(visible);
  const isLast = chosen.size <= 1;

  function toggle(key: string, next: boolean) {
    if (!next && chosen.has(key) && isLast) return;
    const kept = columns
      .map((column) => column.key)
      .filter((candidate) =>
        candidate === key ? next : chosen.has(candidate),
      );
    onVisibleChange(kept);
  }

  const trigger = (
    <Button variant="outline" className="gap-2">
      <SlidersHorizontalIcon data-icon="inline-start" />
      <span className="hidden sm:inline">Columns</span>
      <span className="text-muted-foreground tabular-nums">
        {chosen.size}/{columns.length}
      </span>
      <ShortcutHint keys="f12" className="hidden md:inline-flex" />
    </Button>
  );

  const body = (
    <div className="flex flex-col gap-3">
      {columns.map((column) => {
        const checked = chosen.has(column.key);
        return (
          <div key={column.key} className="flex min-h-11 items-center gap-3 md:min-h-8">
            <Checkbox
              id={`column-${column.key}`}
              checked={checked}
              disabled={checked && isLast}
              onCheckedChange={(next: boolean) => {
                toggle(column.key, next);
              }}
            />
            <Label htmlFor={`column-${column.key}`} className="flex-1 cursor-pointer font-normal">
              {column.header}
            </Label>
          </div>
        );
      })}
    </div>
  );

  const reset = (
    <Button variant="ghost" size="sm" className="gap-2" onClick={onReset}>
      <ArrowCounterClockwiseIcon data-icon="inline-start" />
      Reset to defaults
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="max-h-[85vh] gap-0">
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>Columns</SheetTitle>
            <SheetDescription>Choose what this report shows.</SheetDescription>
          </SheetHeader>
          {/* min-h-0 so the list scrolls instead of pushing the footer off. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
          <SheetFooter className="shrink-0 border-t">{reset}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-64">
        <PopoverTitle className="sr-only">Columns</PopoverTitle>
        <PopoverDescription className="sr-only">
          Choose what this report shows.
        </PopoverDescription>
        <ScrollArea className="max-h-80 pr-3">{body}</ScrollArea>
        <div className="mt-3 border-t pt-3">{reset}</div>
      </PopoverContent>
    </Popover>
  );
}
