import { useState, type ReactNode } from 'react';
import { CaretUpDownIcon, CheckIcon, XIcon, WarningDiamondIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

/**
 * One record, chosen by typing — the combobox this product does not have.
 *
 * CLAUDE.md §3 forbids a raw control and directs a missing primitive to be
 * composed from shadcn primitives and kept in `components/shared` so it is
 * reused rather than re-invented. The registry's own `combobox` could not be
 * installed: its add command rewrites `button.tsx`, which is out of bounds
 * while several slices are in flight. So this is that composition — `Command`
 * for the filtered list, `Popover` on a pointer, a bottom `Sheet` on a phone,
 * which is the surface switch rule 1 requires of every picker.
 *
 * Generic over the option, because the employee form alone needs four of these
 * over four different collections and a per-collection copy is four places for
 * the mobile branch to be forgotten.
 */

export interface PickerOption {
  id: string;
  /** 15 REQ-AO-09: why to look twice before choosing (a likely duplicate), shown before it is chosen. */
  warning?: string;
  /** The line the reader searches and reads. */
  label: string;
  /** A code or a qualifier, shown dimmed at the end of the row. */
  hint?: string;
}

interface RecordPickerProps {
  /** Null when nothing is chosen. */
  value: PickerOption | null;
  onValueChange: (value: PickerOption | null) => void;
  options: readonly PickerOption[];
  /** Names the control, and titles the sheet on a phone. */
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  /** Offers a "clear" row, for a field that is genuinely optional. */
  clearable?: boolean;
  clearLabel?: string;
  id?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export function RecordPicker({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  searchPlaceholder = 'Search',
  emptyMessage = 'Nothing matches that.',
  loading = false,
  clearable = false,
  clearLabel = 'None',
  id,
  icon,
  disabled = false,
}: RecordPickerProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const trigger = (
    <Button
      id={id}
      variant="outline"
      disabled={disabled}
      aria-label={label}
      className="w-full justify-between gap-2 font-normal"
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        {value?.warning !== undefined ? <WarningDiamondIcon weight="fill" className="text-destructive shrink-0" aria-label={value.warning} /> : null}
        <span className={cn('truncate', value === null && 'text-muted-foreground')}>
          {value === null ? placeholder : value.label}
        </span>
      </span>
      <CaretUpDownIcon className="text-muted-foreground shrink-0" />
    </Button>
  );

  const list = (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
            <Spinner />
            Loading
          </div>
        ) : (
          <>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {clearable ? (
                <CommandItem
                  value={clearLabel}
                  className="gap-2"
                  onSelect={() => {
                    onValueChange(null);
                    setOpen(false);
                  }}
                >
                  <XIcon className={cn('shrink-0', value === null ? '' : 'invisible')} />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {clearLabel}
                  </span>
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  // Both parts, so a search matches the code as well as the name.
                  value={`${option.label} ${option.hint ?? ''}`}
                  className="gap-2"
                  onSelect={() => {
                    onValueChange(option);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn('shrink-0', value?.id === option.id ? '' : 'invisible')}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.warning === undefined ? null : (
                    <span title={option.warning} className="text-destructive flex shrink-0">
                      <WarningDiamondIcon weight="fill" aria-label={option.warning} />
                    </span>
                  )}
                  {option.hint === undefined ? null : (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {option.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        {/* Rendered by the Sheet rather than wrapped in it, so the button keeps
            its own focus management. */}
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="max-h-[85vh] gap-0">
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription>{searchPlaceholder}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        {list}
      </PopoverContent>
    </Popover>
  );
}
