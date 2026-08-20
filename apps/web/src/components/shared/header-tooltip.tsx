import type { ReactElement } from 'react';

import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HeaderTooltipProps {
  /** What the control does, in the words the product uses elsewhere. */
  label: string;
  /** The TallyPrime key, if the control has one. */
  keys?: string;
  /** Documented fallback for a browser-reserved key (PRD §6.4). */
  alias?: string;
  /** The control itself. Rendered as the trigger, not wrapped in one. */
  children: ReactElement;
}

/**
 * A header control's name and key, on hover, instead of beside it.
 *
 * The header used to advertise each shortcut with a visible `ShortcutHint`
 * inside the button, which PRD §6.4 asks for. At three controls that meant up
 * to eight key chips sitting permanently in a 56px bar — the calculator alone
 * rendered "Ctrl N or Alt N", five chips for one icon — and the row was mostly
 * chrome describing itself. The chip moves in here, where it is shown on
 * demand and costs nothing when it is not wanted.
 *
 * This is a deliberate departure from §6.4's "renders a small hint chip",
 * recorded in OPEN-QUESTIONS as G-10. The key stays discoverable three ways:
 * here on hover, in the Ctrl+F1 sheet which lists every active shortcut, and
 * in the guided tour. It is not hidden, only no longer permanent.
 *
 * `render` rather than a wrapping element, so the tooltip hangs off the real
 * control and does not add a box to the flex row.
 */
export function HeaderTooltip({ label, keys, alias, children }: HeaderTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {keys ? <ShortcutHint keys={keys} alias={alias} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
