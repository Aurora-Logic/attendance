import type { ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * A checkbox or a switch with a tap target a thumb can actually hit.
 *
 * The global 44px floor in index.css is keyed on `button`, and Base UI renders
 * both of these as a `span` with a role plus a 1x1 hidden input — measured in
 * Chrome under touch emulation, not assumed. So neither control is raised by
 * that rule, and left alone a checkbox stays a 16px square on a phone.
 *
 * Raising the control itself would be the wrong fix: a 44px checkbox is a
 * blot, and a 44px-tall switch is a capsule twice its designed height. The
 * target belongs on the label instead — a click on a `<label>` activates the
 * control it names — so the whole row is tappable and the control keeps its
 * shape. `min-w` matters as much as `min-h`: a row-selection checkbox has a
 * visually hidden label, and without it the target measured 16x44.
 */

interface ControlRowProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  description?: string;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function CheckboxRow({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
  className,
}: ControlRowProps) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex w-fit items-center justify-center gap-2 font-normal pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        disabled && 'opacity-50',
        className,
      )}
    >
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      {label}
    </Label>
  );
}

/**
 * A switch with its label on the left and the control on the right, which is
 * how a settings row reads. The whole row is the target.
 */
export function SwitchRow({
  id,
  label,
  checked,
  disabled,
  description,
  onCheckedChange,
  className,
}: ControlRowProps) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex w-full items-center justify-between gap-4 font-normal pointer-coarse:min-h-11',
        disabled && 'opacity-50',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs">{label}</span>
        {description ? (
          <span className="text-muted-foreground text-[0.6875rem] leading-normal">
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        className="shrink-0"
        onCheckedChange={onCheckedChange}
      />
    </Label>
  );
}
