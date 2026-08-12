import { useEffect, useState } from 'react';

/**
 * The clock on the punch screen, driven by the server (REQ-D-04, REQ-D-13).
 *
 * REQ-D-05 says client time is never trusted for a policy decision. The device
 * clock is also the one thing on a shop floor that is reliably wrong, so a
 * screen that displays `new Date()` next to a shift window is telling people
 * they are on time when the server disagrees.
 *
 * So the display is anchored to the instant the server reported and advanced
 * by elapsed time from `performance.now()`, which is monotonic. `Date.now()`
 * would work until somebody's phone resynchronised its clock mid-shift, at
 * which point the ticking display would jump backwards.
 *
 * The anchor is sampled where the response arrives, not here: reading a clock
 * during render is impure, and the honest moment to measure "how long ago was
 * this true" is the moment it became true.
 */

export interface ClockAnchor {
  /** The server instant, in epoch milliseconds. */
  serverEpoch: number;
  /** `performance.now()` when that instant arrived. */
  receivedAt: number;
  /** Server minus device clock, measured at the same moment. */
  skewMs: number;
}

/** REQ-D-05: past this the punch is flagged. */
export const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

/**
 * Returns the current server time, or null before the first answer. It never
 * falls back to the device clock, because a plausible wrong time on this
 * screen is worse than no time at all.
 */
export function useServerClock(anchor: ClockAnchor | null): Date | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!anchor) return undefined;
    // One second is the resolution the display shows. A faster tick would
    // re-render the whole screen for a digit nobody can read.
    const timer = window.setInterval(() => {
      setNowMs(anchor.serverEpoch + (performance.now() - anchor.receivedAt));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [anchor]);

  if (!anchor) return null;
  // Until the first tick, show the instant the server reported. It is at most
  // one second stale and it is a real server time, not a guess.
  return new Date(nowMs ?? anchor.serverEpoch);
}
