import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * When a chart is allowed to animate, which is almost never. Lifted to
 * shared when the reports surface became the fourth copy's would-be home
 * (vyuha-charts §2); the dashboard, attendance and employees copies migrate
 * here as they are next touched.
 *
 * A dashboard is opened a dozen times a day. An entrance animation that
 * charms on Monday is a wait by Wednesday, so the rule here is narrow: a
 * chart draws itself once, on the first paint after its data arrives, and
 * never again. Changing the period, refetching, hovering a tooltip and
 * resizing all redraw instantly.
 *
 * Recharts animates through requestAnimationFrame, not CSS, so the blanket
 * `prefers-reduced-motion` collapse in index.css cannot reach it — that rule
 * zeroes transition and animation durations, and there is no CSS animation
 * here to zero. The preference has to be read in JavaScript and passed to
 * recharts as `isAnimationActive={false}`, which is what this does.
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
