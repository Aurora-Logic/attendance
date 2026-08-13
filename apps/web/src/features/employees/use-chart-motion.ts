import { useEffect, useState } from 'react';

/**
 * Whether a chart on this screen should animate its draw, and for how long.
 *
 * Two rules decide it, and neither is a style preference.
 *
 * NFR-07 respects `prefers-reduced-motion`, and `index.css` collapses every
 * CSS transition and animation to nothing to honour it. Recharts does not use
 * CSS — it interpolates in JavaScript on a requestAnimationFrame loop — so
 * that blanket rule reaches none of it, and a chart left on its defaults
 * animates for 1500ms in front of a reader who asked for stillness. The media
 * query has to be read here, in script, or it is not respected at all.
 *
 * The second rule is frequency. This screen is opened once per employee by
 * somebody working down the register, so a draw on first paint is a moment of
 * orientation; the same motion replayed every time the month steps is lag
 * between the key and the answer. So the window closes shortly after the first
 * data arrives and never reopens for the life of the component.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Long enough to read as a draw, short enough that nobody waits on it. */
export const CHART_DRAW_MS = 280;

/**
 * The gap between one chart starting and the next.
 *
 * Three charts drawing in perfect unison read as one animation of the whole
 * page; a short offset makes them read as three things arriving. Long enough
 * to notice, short enough that the last one is finished inside half a second
 * and nothing is waiting on it.
 */
export const CHART_STAGGER_MS = 60;

/**
 * `--ease-out-strong` from `index.css`, written out because recharts
 * interpolates in JavaScript and cannot read a CSS custom property.
 *
 * The stock `ease-out` is too weak to read as intentional over a bar growing
 * from the axis, and `ease-in` and `ease-in-out` are both wrong for something
 * entering: they hold back the first frame, which is the frame the eye is on.
 * Keeping the same curve the sheets and popovers use means one motion language
 * across the product rather than a second one that only charts speak.
 */
export const CHART_EASING = 'cubic-bezier(0.23,1,0.32,1)' as const;

export function useChartMotion(delayMs = 0): {
  animate: boolean;
  durationMs: number;
  beginMs: number;
} {
  const [reduced, setReduced] = useState(
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  const [inDrawWindow, setInDrawWindow] = useState(true);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => {
      setReduced(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    // A little past the draw so the flag flips after the last frame rather
    // than mid-flight, which would snap the bars to their final height.
    const timer = window.setTimeout(() => {
      setInDrawWindow(false);
    }, delayMs + CHART_DRAW_MS + 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs]);

  // A delay is motion too, so a reader who asked for stillness gets neither.
  return {
    animate: inDrawWindow && !reduced,
    durationMs: CHART_DRAW_MS,
    beginMs: reduced ? 0 : delayMs,
  };
}
