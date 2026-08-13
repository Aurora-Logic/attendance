import { CheckCircleIcon, CompassIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Button } from '@/components/ui/button';
import { shouldOfferUnprompted, useGuideStore } from '@/lib/guide-store';

/**
 * The tour is offered here, on the sign-in screen, and nowhere else unprompted.
 *
 * Offered rather than started. The same account type is used by a shop-floor
 * employee who opens Punch and closes the tab; taking over their first sign-in
 * to explain a Reports menu they cannot open is hostile. See OPEN-QUESTIONS
 * G-1, which records this as the default in use rather than a settled answer.
 *
 * Pressing it cannot start anything: there is no session yet, and the tour is
 * filtered by the permission set, so it would have nothing to filter. The
 * request is parked in the store and collected by `GuideOverlay` on the first
 * authenticated render.
 *
 * Renders nothing for anyone who has already taken it or already said no, so
 * the sign-in screen stays a sign-in screen for everybody but a newcomer.
 */
export function SignInTourOffer() {
  const completedAt = useGuideStore((s) => s.completedAt);
  const dismissedAt = useGuideStore((s) => s.dismissedAt);
  const armed = useGuideStore((s) => s.armed);
  const arm = useGuideStore((s) => s.arm);
  const consumeArmed = useGuideStore((s) => s.consumeArmed);
  const dismiss = useGuideStore((s) => s.dismiss);

  if (!shouldOfferUnprompted({ completedAt, dismissedAt })) return null;

  if (armed) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 border-t pt-4 text-xs">
        <CheckCircleIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0">The tour starts once you sign in.</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-auto shrink-0 px-2 py-1 text-xs font-normal"
          onClick={consumeArmed}
        >
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="text-muted-foreground flex items-start gap-2 text-xs">
        <CompassIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0">
          First time here? A short tour of the screens you can open, starting once you sign in.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* The compass rather than a verb-table entry: starting a tour is not
            one of the recurring actions, and `skip` would draw a
            skip-forward arrow on the button that begins the thing. */}
        {/* Wrapped, not passed by reference: `arm` takes an optional step id,
            and handing it straight to onClick would arm the tour with a mouse
            event as the step to open at. */}
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            arm();
          }}
        >
          <CompassIcon data-icon="inline-start" />
          Show me around
        </Button>
        {/* A permanent no, not a "later". Asking again on every sign-in is the
            behaviour this button exists to switch off — which is exactly the
            verb table's `skip`. */}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground flex-1 font-normal"
          onClick={dismiss}
        >
          <ACTION_ICONS.skip data-icon="inline-start" />
          Not now
        </Button>
      </div>
    </div>
  );
}
