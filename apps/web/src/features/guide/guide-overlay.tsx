import { useEffect, type CSSProperties } from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { useGuideStore } from '@/lib/guide-store';
import { useSessionStore } from '@/lib/session/session-store';

import { GuideBubble } from './guide-bubble';
import { REGISTRY_VERSION } from './tour-steps';
import { useGuideRun, type AnchorRect } from './use-guide-run';

/** Breathing room between the highlighted control and the edge of the cutout. */
const CUTOUT_PADDING = 4;

/**
 * The dimming layer, with a hole over the control the step is about.
 *
 * One element. The hole is not a hole in the usual sense — the element *is*
 * the hole, and an outsized spread on the box-shadow paints everything outside
 * it. That keeps the cutout to a single node with no clip-path and no SVG
 * mask, and it means the dimming and the ring around the control are two
 * layers of the same shadow rather than two competing box-shadows.
 *
 * `pointer-events-none` is the load-bearing part: the control underneath stays
 * genuinely clickable, so the tour can say "press this" and be obeyed. A tour
 * that blocks the thing it is pointing at is worse than no tour.
 *
 * The rect arrives as custom properties rather than as style declarations.
 * A measured rectangle cannot be a Tailwind class, and this is the same escape
 * `ui/toggle-group` and `ui/sidebar` already use — data through variables,
 * every actual style still in a class (CLAUDE.md §3 rule 1).
 */
function GuideScrim({ rect }: { rect: AnchorRect }) {
  const geometry = {
    '--guide-top': `${String(rect.top - CUTOUT_PADDING)}px`,
    '--guide-left': `${String(rect.left - CUTOUT_PADDING)}px`,
    '--guide-width': `${String(rect.width + CUTOUT_PADDING * 2)}px`,
    '--guide-height': `${String(rect.height + CUTOUT_PADDING * 2)}px`,
  } as CSSProperties;

  return (
    <div
      aria-hidden
      style={geometry}
      className="pointer-events-none fixed top-(--guide-top) left-(--guide-left) z-40 h-(--guide-height) w-(--guide-width) shadow-[0_0_0_2px_var(--color-primary),0_0_0_9999px_rgb(0_0_0/0.5)] transition-[top,left,width,height] duration-240 ease-in-out-strong"
    />
  );
}

/**
 * The tour's keys, registered inside its own layer.
 *
 * They have to be declared here rather than in `GuideOverlay`: `useShortcut`
 * reads the layer from context, so a registration made in the component that
 * *renders* the layer lands in the layer above it and never fires, because the
 * dispatcher only runs the topmost layer plus globals.
 *
 * Arrow keys rather than Enter. Enter is "drill down into the focused row" in
 * PRD §6.4, and intercepting it here would mean pressing Enter on the Back
 * button moved the tour forwards — the dispatcher runs in the capture phase,
 * so the shortcut wins and the button never sees the press.
 */
function GuideKeys({
  onNext,
  onBack,
  onStop,
}: {
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}) {
  useShortcut({
    id: 'guide.next',
    keys: 'right',
    label: 'Guided tour: next step',
    scope: 'modal',
    run: onNext,
  });
  useShortcut({
    id: 'guide.back',
    keys: 'left',
    label: 'Guided tour: previous step',
    scope: 'modal',
    run: onBack,
  });
  useShortcut({
    id: 'guide.stop',
    keys: 'escape',
    label: 'Guided tour: stop',
    scope: 'modal',
    run: onStop,
  });

  return null;
}

/**
 * Runs the guided tour.
 *
 * Mounted once by the shell and renders nothing at all until a run starts, so
 * the cost of shipping it to somebody who never takes the tour is one
 * component that returns null.
 */
export function GuideOverlay() {
  const run = useGuideRun();
  const { status, step, steps, index, rect, skippedCount, scope, start, next, back, stop } = run;

  const sessionStatus = useSessionStore((s) => s.status);
  const armed = useGuideStore((s) => s.armed);
  const armedFromStepId = useGuideStore((s) => s.armedFromStepId);
  const armedScope = useGuideStore((s) => s.armedScope);
  const consumeArmed = useGuideStore((s) => s.consumeArmed);
  const complete = useGuideStore((s) => s.complete);
  const dismiss = useGuideStore((s) => s.dismiss);

  /*
   * The hand-off from the sign-in screen.
   *
   * "Show me around" is pressed before there is a session, and the tour cannot
   * run before one exists — it is filtered by the permission set. So the
   * request is parked in the store and collected here.
   *
   * Waiting on `sessionStatus` is load-bearing, not defensive. `SessionGate`
   * writes the permission set in an effect, and React runs a child's effects
   * before its parent's — so on the first authenticated render this component
   * is already mounted while the store is still empty. Starting there froze a
   * five-step list for an administrator entitled to twenty-one, and every
   * screen step was silently filtered away as unpermitted. Found by driving
   * the real app; nothing about the code looked wrong.
   */
  useEffect(() => {
    if (!armed || status !== 'idle' || sessionStatus !== 'authenticated') return;
    // Read before consuming: consumeArmed clears both fields, and reading
    // afterwards would always start from the beginning.
    const fromStepId = armedFromStepId;
    const requestedScope = armedScope ?? 'all';
    consumeArmed();
    start({ scope: requestedScope, ...(fromStepId ? { fromStepId } : {}) });
  }, [armed, armedFromStepId, armedScope, status, sessionStatus, consumeArmed, start]);

  if (status === 'idle') return null;

  if (status === 'finished') {
    const shown = steps.length - skippedCount;
    const isPage = scope === 'page';
    // Says what actually happened. A step whose anchor never turned up was not
    // shown, and claiming otherwise would be a lie the reader cannot check.
    const count =
      skippedCount > 0
        ? `You saw ${String(shown)} of ${String(steps.length)} steps.`
        : `You saw all ${String(steps.length)} steps.`;

    const finish = () => {
      // Only a whole-product run counts as having taken the tour. Finishing a
      // page guide must not silence the first-run offer for the rest of the
      // product somebody has not seen yet.
      if (!isPage) complete(REGISTRY_VERSION);
      stop();
    };

    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) finish();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isPage ? 'That is this screen' : 'That is the tour'}</DialogTitle>
            <DialogDescription>
              {count}{' '}
              {isPage
                ? 'Press Ctrl+F1 on any screen for the same walk through that one.'
                : 'Alt+G gets you anywhere and Ctrl+F1 explains whichever screen you are on. The full tour is in your account menu whenever you want it again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* A page guide offers the whole thing; the whole thing has
                nothing left to offer. */}
            {isPage ? (
              <Button
                variant="outline"
                onClick={() => {
                  stop();
                  start({ scope: 'all' });
                }}
              >
                See the whole product
              </Button>
            ) : null}
            <DialogClose render={<Button>Done</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (!step) return null;

  // Stopping part-way records that the offer was answered, so the invitation
  // does not reappear on the next sign-in. The resume point is deliberately
  // left in place — the account menu leads straight back to it.
  const abandon = () => {
    dismiss();
    stop();
  };

  return (
    <ShortcutLayer id="modal:guide">
      <GuideKeys onNext={next} onBack={back} onStop={abandon} />
      {rect ? <GuideScrim rect={rect} /> : null}
      <GuideBubble
        step={step}
        rect={rect}
        index={index}
        total={steps.length}
        onNext={next}
        onBack={back}
        onStop={abandon}
      />
    </ShortcutLayer>
  );
}
