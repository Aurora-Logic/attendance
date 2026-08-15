import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useIsMobile } from '@/hooks/use-mobile';
import { useGuideStore } from '@/lib/guide-store';
import { usePermissions } from '@/lib/session/permissions';

import {
  anchorFor,
  REGISTRY_VERSION,
  resolvePageSteps,
  resolveSteps,
  type GuideStep,
} from './tour-steps';

/**
 * How long to wait for a step's anchor to turn up after navigating.
 *
 * A route change plus a first render plus a query settling is comfortably
 * inside this. Past it, the honest conclusion is that the anchor is not coming.
 */
const ANCHOR_TIMEOUT_MS = 1500;

export type GuideStatus = 'idle' | 'running' | 'finished';

/**
 * How much of the product a run covers.
 *
 * `page` is the common case and the one the shortcut sheet offers: somebody is
 * looking at a screen and wants that screen explained, not a walk from the
 * sidebar to the audit log. `all` is the first-run orientation.
 */
export type GuideScope = 'page' | 'all';

export interface StartOptions {
  scope?: GuideScope;
  fromStepId?: string;
}

/** Viewport coordinates, so the scrim can be positioned fixed. */
export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface GuideRun {
  status: GuideStatus;
  steps: GuideStep[];
  index: number;
  step: GuideStep | null;
  anchorEl: HTMLElement | null;
  rect: AnchorRect | null;
  /** Steps whose anchor never appeared. Reported honestly on the closing card. */
  skippedCount: number;
  /** What the current run covers, for the closing card's wording. */
  scope: GuideScope;
  start: (options?: StartOptions) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
}

function findAnchor(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-guide="${name}"]`);
}

/**
 * Resolves an anchor that may not exist yet.
 *
 * Polling with a MutationObserver rather than a fixed delay: a route that
 * renders instantly should not be made to wait, and one that waits on a query
 * should not be given up on early. Resolves `null` at the ceiling, and the
 * caller skips — a missing anchor must never strand somebody mid-tour.
 */
function waitForAnchor(name: string, signal: AbortSignal): Promise<HTMLElement | null> {
  const immediate = findAnchor(name);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (element: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(element);
    };

    const onAbort = () => {
      finish(null);
    };

    const observer = new MutationObserver(() => {
      const found = findAnchor(name);
      if (found) finish(found);
    });

    const timer = setTimeout(() => {
      finish(null);
    }, ANCHOR_TIMEOUT_MS);

    signal.addEventListener('abort', onAbort, { once: true });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The tallest a cutout may be, as a fraction of the viewport.
 *
 * A records table is routinely taller than the screen. Highlighting all of it
 * dims nothing — the "spotlight" becomes the whole window — and leaves the
 * card nowhere to sit, so it is pushed off the bottom of the screen. Found by
 * looking at a screenshot of the Employees guide, not by reading the code.
 */
const MAX_CUTOUT_FRACTION = 0.42;

/**
 * The anchor's rectangle, clamped to something a spotlight can actually be.
 *
 * Two clamps, for two different failures. Intersecting with the viewport stops
 * an anchor scrolled half out of view from dragging the cutout off with it.
 * Capping the height keeps a long table from swallowing the screen — the top
 * of a table is its header and first rows, which is the part that says "these
 * are the records" anyway.
 *
 * For an ordinary control the clamps do nothing and the rectangle is the
 * element's own.
 */
function rectOf(element: HTMLElement): AnchorRect {
  const r = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const top = Math.max(0, r.top);
  const left = Math.max(0, r.left);
  const width = Math.max(0, Math.min(viewportWidth, r.right) - left);
  const visibleHeight = Math.max(0, Math.min(viewportHeight, r.bottom) - top);
  const height = Math.min(visibleHeight, Math.round(viewportHeight * MAX_CUTOUT_FRACTION));

  return { top, left, width, height };
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function useGuideRun(): GuideRun {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const granted = usePermissions();

  const recordStep = useGuideStore((s) => s.recordStep);
  const clearResume = useGuideStore((s) => s.clearResume);

  const [status, setStatus] = useState<GuideStatus>('idle');
  const [index, setIndex] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  /**
   * The resolved anchor, tagged with the step it was resolved for.
   *
   * Tagged rather than cleared. Clearing it at the top of the step effect
   * would be a setState in an effect body — a cascading render, and the lint
   * rule that catches it is right: the previous step's anchor is not stale
   * state to be wiped, it is simply not this step's, which the tag says
   * without a second render pass.
   */
  const [resolved, setResolved] = useState<{
    stepId: string;
    el: HTMLElement;
    rect: AnchorRect;
  } | null>(null);

  /**
   * The step list is frozen when the run starts.
   *
   * Recomputing it from live permissions mid-run would let a background `/me`
   * refetch change the list length under a run that is already counting
   * against it, and "step 7 of 13" would become "step 7 of 12" between two
   * presses of Next.
   */
  const [frozenSteps, setFrozenSteps] = useState<GuideStep[] | null>(null);
  const [scope, setScope] = useState<GuideScope>('all');
  const liveSteps = useMemo(() => resolveSteps(granted, isMobile), [granted, isMobile]);
  const steps = frozenSteps ?? liveSteps;

  const step = status === 'running' ? (steps[index] ?? null) : null;

  // Only this step's anchor counts. Anything left from the previous step is
  // not stale state to be cleared, it is simply tagged with a different id.
  const active = step && resolved?.stepId === step.id ? resolved : null;
  const anchorEl = active?.el ?? null;
  const rect = active?.rect ?? null;

  const start = useCallback(
    (options?: StartOptions) => {
      const nextScope = options?.scope ?? 'all';

      /*
       * A page guide is composed by looking at the page.
       *
       * Furniture is included only when the screen actually renders it, which
       * is a question the DOM can answer right now — we are already standing on
       * the route. Deciding it from a per-route list instead would be a second
       * source of truth that goes stale the first time a screen gains a table.
       */
      const resolvedSteps =
        nextScope === 'page'
          ? resolvePageSteps(window.location.pathname, granted, isMobile, (anchor) =>
              document.querySelector(`[data-guide="${anchor}"]`) !== null,
            )
          : resolveSteps(granted, isMobile);

      if (resolvedSteps.length === 0) return;

      const from = options?.fromStepId
        ? resolvedSteps.findIndex((s) => s.id === options.fromStepId)
        : -1;

      setScope(nextScope);

      setFrozenSteps(resolvedSteps);
      // A resume point that no longer exists in the registry starts over
      // rather than silently landing somewhere else.
      setIndex(from >= 0 ? from : 0);
      setSkippedCount(0);
      setResolved(null);
      setStatus('running');
    },
    [granted, isMobile],
  );

  const stop = useCallback(() => {
    setStatus('idle');
    setFrozenSteps(null);
    setResolved(null);
  }, []);

  const next = useCallback(() => {
    setIndex((current) => {
      if (current >= steps.length - 1) {
        setStatus('finished');
        clearResume();
        return current;
      }
      return current + 1;
    });
  }, [steps.length, clearResume]);

  const back = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  /*
   * Drive the current step: navigate if it lives elsewhere, wait for the
   * anchor, scroll it into view, then measure.
   *
   * Skipping is done by advancing rather than by filtering, so the count the
   * closing card reports stays truthful about what was and was not shown.
   */
  useEffect(() => {
    if (status !== 'running' || !step) return;

    const controller = new AbortController();
    const anchorName = anchorFor(step, isMobile);
    let cancelled = false;

    // The router's own pathname would make this effect a subscriber to every
    // navigation in the app, including ones the tour did not cause. The
    // document is the authority on where the browser actually is, and reading
    // it here costs nothing.
    if (step.route && window.location.pathname !== step.route) {
      void navigate(step.route);
    }

    void waitForAnchor(anchorName, controller.signal).then((element) => {
      if (cancelled) return;

      if (!element) {
        if (import.meta.env.DEV) {
          // A silent skip in development is how a tour rots without anyone
          // noticing. In production it stays silent on purpose.
          console.error(
            `[guide] step "${step.id}" was skipped: no element matched ` +
              `[data-guide="${anchorName}"] within ${String(ANCHOR_TIMEOUT_MS)}ms.`,
          );
        }
        setSkippedCount((n) => n + 1);
        next();
        return;
      }

      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      setResolved({ stepId: step.id, el: element, rect: rectOf(element) });
      recordStep(step.id, REGISTRY_VERSION);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `next` and `recordStep` are stable; `step` identity drives this.
  }, [status, step, isMobile, navigate, next, recordStep]);

  /*
   * Keep the cutout on the anchor while the page moves underneath it.
   *
   * A sticky header, a scrolling table and a window resize all move an element
   * without changing anything React would re-render for, so this listens
   * rather than recomputing on render. Coalesced into a frame because scroll
   * fires far more often than the screen refreshes.
   */
  useEffect(() => {
    if (!anchorEl) return;

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setResolved((current) => {
          if (!current || current.el !== anchorEl) return current;
          const measured = rectOf(anchorEl);
          return sameRect(current.rect, measured) ? current : { ...current, rect: measured };
        });
      });
    };

    const observer = new ResizeObserver(sync);
    observer.observe(anchorEl);
    // Capture, so a scroll inside any container reaches this and not only a
    // scroll of the document.
    window.addEventListener('scroll', sync, { capture: true, passive: true });
    window.addEventListener('resize', sync, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', sync, { capture: true });
      window.removeEventListener('resize', sync);
    };
  }, [anchorEl]);

  return {
    status,
    steps,
    index,
    step,
    anchorEl,
    rect,
    skippedCount,
    scope,
    start,
    next,
    back,
    stop,
  };
}
