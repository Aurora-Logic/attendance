import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * When a chart in this module and in Analytics is allowed to animate.
 *
 * The policy is the dashboard's, and deliberately so: a chart draws itself
 * once, on the first paint after its data arrives, and never again. Changing
 * the period, changing a department, refetching, hovering a tooltip and
 * resizing all redraw instantly. An analytics screen is studied rather than
 * glanced at, which is what makes the first draw defensible at all; re-drawing
 * it on every filter change would turn a filter into a wait.
 *
 * Recharts animates through requestAnimationFrame, not CSS, so the blanket
 * `prefers-reduced-motion` collapse in index.css cannot reach it — that rule
 * zeroes transition and animation durations, and there is no CSS animation
 * here to zero. The preference has to be read in JavaScript and passed to
 * recharts as `isAnimationActive={false}`, which is what this does.
 *
 * This is a copy of `features/dashboard/use-chart-motion.ts` rather than an
 * import of it. Three features now need the same twelve lines and each is
 * owned by a different agent; a screen reaching sideways into another screen's
 * folder for a hook is the dependency that breaks the moment that screen is
 * refactored. When the ownership split ends, these belong in `lib/` as one
 * module and the copies should be deleted, not kept in sync.
 */

/** Recharts takes a duration in ms and one of five named easings, not a curve. */
export const CHART_INTRO_MS = 300;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED_MOTION).matches,
    // Server snapshot. There is no SSR here, but the honest default for
    // "unknown environment" is the calmer one.
    () => true,
  );
}

/**
 * True for exactly one draw, once `ready` turns true.
 *
 * The flag is turned off on a timer rather than in an animation callback
 * because recharts does not expose one per series, and turning it off early
 * would not shorten the animation — it would cut to the final frame mid-draw.
 */
export function useChartIntro(ready: boolean): boolean {
  const reduced = usePrefersReducedMotion();
  const [spent, setSpent] = useState(false);

  useEffect(() => {
    if (!ready || spent) return undefined;
    const timer = window.setTimeout(() => {
      setSpent(true);
    }, CHART_INTRO_MS + 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, spent]);

  return ready && !spent && !reduced;
}
