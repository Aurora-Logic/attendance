import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A popover that points at an element it does not own.
 *
 * `ui/popover.tsx` can only anchor to a `PopoverTrigger` it wraps: its
 * `PopoverContent` forwards `align | alignOffset | side | sideOffset` to the
 * positioner and nothing else. Anything that has to point at an existing
 * control — the guided tour, a field-level callout — has no way to say which
 * element it means.
 *
 * Base UI already supports it. `Popover.Positioner` takes an `anchor` of
 * `Element | VirtualElement | RefObject | () => …`, so this is a missing
 * forward rather than a missing capability. Composed here rather than fixed in
 * place because `ui/` is shadcn's to overwrite: the next `shadcn add popover`
 * would silently take an edit there back out (CLAUDE.md §3 rule 1).
 *
 * The popup styling is copied from `ui/popover.tsx` on purpose, so the two
 * cannot drift apart visually. If that file's popup changes, change this too.
 */

/** Matches `PopoverContent`'s popup in `ui/popover.tsx`. Keep the two in step. */
const POPUP_CLASS =
  'z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-none bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden';

/**
 * Anything with a rectangle, which is all the positioner needs.
 *
 * Base UI calls this a VirtualElement. It is declared structurally here rather
 * than imported from `@floating-ui/utils`, which is a transitive dependency
 * this app has never declared — importing it directly would make a private
 * detail of Base UI into a build-time promise we did not make.
 */
export interface VirtualAnchor {
  getBoundingClientRect: () => DOMRect;
}

interface AnchoredPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The element to point at, or a bare rectangle when there is no element —
   * pinning a popup to a corner of the viewport, for instance.
   *
   * `null` while it is still being looked for: Base UI treats that as "nothing
   * to position against" and leaves the popup where it is, rather than
   * throwing it at the top-left corner and animating it back.
   */
  anchor: Element | VirtualAnchor | null;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
  /**
   * Base UI restores focus here on close. Without it, dismissing a popover
   * anchored to something that has since been unmounted drops focus onto
   * `<body>` and a keyboard user starts again from the top of the document.
   */
  finalFocus?: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function AnchoredPopover({
  open,
  onOpenChange,
  anchor,
  side = 'bottom',
  align = 'center',
  sideOffset = 10,
  className,
  finalFocus,
  children,
}: AnchoredPopoverProps) {
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      // Never modal. The whole point of the tour is that the control it is
      // describing stays usable while it is being described; a modal popover
      // would put an inert layer over the thing it just told you to press.
      modal={false}
    >
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={sideOffset}
          // Above the scrim (z-40) and its click-catcher, so the bubble is
          // never dimmed by the overlay that is meant to be behind it.
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="anchored-popover-content"
            {...(finalFocus ? { finalFocus } : {})}
            className={cn(POPUP_CLASS, className)}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
