import type { ReactNode } from 'react';

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/**
 * The two field shapes every settings tab is made of.
 *
 * Composed once here rather than per tab so the four tabs cannot drift into
 * four spellings of the same control (CLAUDE.md §3 rule 4), and so the
 * enforcement note below is impossible to forget: it is part of the field, not
 * something each call site remembers to add.
 */

/**
 * States, next to the control, whether anything currently reads it.
 *
 * REQ-L-02 lists policy fields that belong to features shipping in a later
 * phase. A switch that visibly moves while nothing reads it is worse than no
 * switch -- it reads as a control that has been turned on. The server decides
 * what goes here; the screen only prints it.
 */
export function EnforcementNote({ by }: { by: string | null | undefined }) {
  if (by === undefined) return null;
  if (by === null) {
    return (
      <FieldDescription>
        Saved and audited, but nothing reads it yet. Changing it does not change behaviour today.
      </FieldDescription>
    );
  }
  return <FieldDescription>In force now. Read by: {by}.</FieldDescription>;
}

interface NumberFieldProps {
  id: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  /** Rendered after the input, e.g. "minutes". */
  unit?: string;
  enforcedBy?: string | null;
  disabled?: boolean;
  onValueChange: (value: number) => void;
}

/**
 * A bounded whole number.
 *
 * `type="number"` on shadcn's Input rather than a slider: these are exact
 * policy values typed from a written policy document, and every one of them is
 * bounded but not small. The same choice, for the same reason, as the shift
 * policy fields.
 */
export function PolicyNumberField({
  id,
  label,
  help,
  value,
  min,
  max,
  unit,
  enforcedBy,
  disabled,
  onValueChange,
}: NumberFieldProps) {
  return (
    <Field data-disabled={disabled ? '' : undefined}>
      <FieldLabel htmlFor={id}>{unit ? `${label} (${unit})` : label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={disabled}
        className="pointer-coarse:h-11 tabular-nums"
        value={String(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          // An emptied field reads as 0, which several of these accept. NaN
          // does not, and is dropped rather than written into the draft.
          if (!Number.isNaN(next)) onValueChange(next);
        }}
      />
      <FieldDescription>{help}</FieldDescription>
      <EnforcementNote by={enforcedBy} />
    </Field>
  );
}

interface ToggleFieldProps {
  id: string;
  label: string;
  help: string;
  value: boolean;
  enforcedBy?: string | null;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}

/**
 * An on/off policy. Horizontal, with the label and its help text to the left
 * of the switch, the same layout `Field` already offers checkbox and radio
 * rows -- a settings tab that put a switch under its label like the other two
 * fields would be the one control on the screen not aligned to what a reader
 * flips.
 */
export function PolicyToggleField({
  id,
  label,
  help,
  value,
  enforcedBy,
  disabled,
  onValueChange,
}: ToggleFieldProps) {
  return (
    <Field orientation="horizontal" data-disabled={disabled ? '' : undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{help}</FieldDescription>
        <EnforcementNote by={enforcedBy} />
      </FieldContent>
      <Switch
        id={id}
        checked={value}
        disabled={disabled}
        onCheckedChange={(next: boolean) => {
          onValueChange(next);
        }}
      />
    </Field>
  );
}

interface ChoiceFieldProps<T extends string> {
  id: string;
  label: string;
  help?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  enforcedBy?: string | null;
  disabled?: boolean;
  onValueChange: (value: T) => void;
  /** Rendered under the enforcement note, for a per-field caveat. */
  children?: ReactNode;
}

export function PolicyChoiceField<T extends string>({
  id,
  label,
  help,
  value,
  options,
  enforcedBy,
  disabled,
  onValueChange,
  children,
}: ChoiceFieldProps<T>) {
  return (
    <Field data-disabled={disabled ? '' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next: string | null) => {
          // Base UI hands back null when a select is cleared. This one cannot
          // be, but the handler still has to accept it.
          if (next !== null) onValueChange(next as T);
        }}
      >
        <SelectTrigger id={id} aria-label={label} className="pointer-coarse:h-11 w-full">
          <SelectValue>
            {(current: string) =>
              options.find((option) => option.value === current)?.label ?? current
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {help ? <FieldDescription>{help}</FieldDescription> : null}
      <EnforcementNote by={enforcedBy} />
      {children}
    </Field>
  );
}
