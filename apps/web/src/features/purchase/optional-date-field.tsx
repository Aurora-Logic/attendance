import { XIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';

/**
 * A date that may be left unset: a needed-by date on a requirement, an
 * expected date on a PO. `DateField` always holds a date, so "none" is a
 * button that offers to set one, and a set date carries a clear button
 * beside it — the same shape the estimate's valid-until uses.
 */
export function OptionalDateField({
  label,
  emptyLabel,
  value,
  onValueChange,
  disabled = false,
  defaultOffsetDays = 7,
}: {
  label: string;
  /** What the unset control reads, e.g. "No date — set one". */
  emptyLabel: string;
  /** `YYYY-MM-DD`, or null. */
  value: string | null;
  onValueChange: (next: string | null) => void;
  disabled?: boolean;
  /** Where the picker lands when a date is first set, in days from today. */
  defaultOffsetDays?: number;
}) {
  if (value === null) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start font-normal"
        disabled={disabled}
        aria-label={label}
        onClick={() => {
          onValueChange(toDateParam(new Date(Date.now() + defaultOffsetDays * 86_400_000)));
        }}
      >
        <span className="text-muted-foreground">{emptyLabel}</span>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <DateField
          label={label}
          value={fromDateParam(value)}
          onValueChange={(next) => {
            if (!disabled) onValueChange(toDateParam(next));
          }}
          yearsBack={0}
          yearsForward={2}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Clear ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => {
          onValueChange(null);
        }}
      >
        <XIcon />
      </Button>
    </div>
  );
}
