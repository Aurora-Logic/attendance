import { useMemo } from 'react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { AnchoredPopover, type VirtualAnchor } from '@/components/shared/anchored-popover';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

import type { GuideStep } from './tour-steps';
import type { AnchorRect } from './use-guide-run';

interface GuideBubbleProps {
  step: GuideStep;
  /**
   * The highlighted rectangle. The card is positioned against this rather than
   * against the element itself, so that the two can never disagree: the rect is
   * clamped to the viewport and capped in height, and a card anchored to the
   * raw element would be placed below a table that is three screens tall.
   */
  rect: AnchorRect | null;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}

/**
 * Where the phone's card sits: along the bottom edge, but never below the top
 * of the thing being highlighted.
 *
 * Anchoring flatly to the bottom of the viewport is wrong for the one step
 * that matters most on a phone — the bottom navigation bar — because the card
 * then lands squarely on top of the control the cutout is trying to show. So
 * the line it aims at is the higher of the two: the viewport's bottom edge, or
 * the top of the highlighted rectangle. Everything else on the screen is above
 * the fold, so this only moves for anchors that are genuinely down there.
 *
 * A zero-height strip rather than a real box: the popover is placed on its
 * `top` side, so the card's lower edge lands on the line and nothing else
 * about the anchor matters.
 */
function useBottomOfScreenAnchor(enabled: boolean, rect: AnchorRect | null): VirtualAnchor | null {
  const anchorTop = rect?.top ?? null;

  return useMemo(() => {
    if (!enabled) return null;
    return {
      getBoundingClientRect: () => {
        const line = anchorTop === null ? window.innerHeight : Math.min(window.innerHeight, anchorTop);
        return new DOMRect(window.innerWidth / 2, line, 0, 0);
      },
    };
  }, [enabled, anchorTop]);
}

/**
 * The step's card.
 *
 * One component at both widths, because the difference is where it is anchored
 * rather than what it is. On a phone it aims at the bottom edge of the screen
 * instead of the control — a card pinned next to a control at 360px is out of
 * thumb reach and crowds the very thing the cutout is trying to show. That is
 * the Sheet decision from CLAUDE.md §3, taken without a Sheet: `ui/sheet` is a
 * dialog underneath, and its overlay and focus trap would cover the control
 * this is describing and make it unclickable, which is the one thing the tour
 * must never do.
 */
export function GuideBubble({
  step,
  rect,
  index,
  total,
  onNext,
  onBack,
  onStop,
}: GuideBubbleProps) {
  const isMobile = useIsMobile();
  const bottomAnchor = useBottomOfScreenAnchor(isMobile, rect);

  // The same rectangle the cutout draws, so the card and the hole always agree.
  const spotlightAnchor = useMemo<VirtualAnchor | null>(() => {
    if (!rect) return null;
    const { top, left, width, height } = rect;
    return { getBoundingClientRect: () => new DOMRect(left, top, width, height) };
  }, [rect]);

  const anchor = isMobile ? bottomAnchor : spotlightAnchor;
  const isLast = index === total - 1;

  return (
    <AnchoredPopover
      // Open for the whole run, not per step. The anchor changing from one
      // control to the next repositions the same popup, which is what makes it
      // travel; toggling open would re-run the entrance and steal focus back
      // on every press of Next.
      open
      // Deliberately inert. Base UI reports an outside press here, and acting
      // on it would end the tour the instant somebody pressed the control the
      // step had just told them to press. `open` is controlled, so ignoring
      // the report keeps the popup up. Leaving is Skip, Finish or Escape.
      onOpenChange={() => undefined}
      anchor={anchor}
      side={isMobile ? 'top' : (step.side ?? 'bottom')}
      align="center"
      sideOffset={isMobile ? 16 : 10}
      className="w-80 max-w-[calc(100vw-1.5rem)] gap-3 p-4"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-[0.7rem] font-medium tracking-wide tabular-nums">
          Step {index + 1} of {total}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-foreground text-sm font-medium">{step.title}</h2>
          {step.shortcut ? (
            <ShortcutHint keys={step.shortcut} alias={step.shortcutAlias} />
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs/relaxed">{step.body}</p>
      </div>

      <div className="flex items-center gap-2">
        {/* Leaving is never harder to reach than continuing. */}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onStop}>
          <ACTION_ICONS.skip data-icon="inline-start" />
          Skip
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={index === 0} onClick={onBack}>
            <ACTION_ICONS.back data-icon="inline-start" />
            Back
          </Button>
          <Button size="sm" onClick={onNext}>
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </AnchoredPopover>
  );
}
