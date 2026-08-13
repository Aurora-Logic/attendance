import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * What this browser remembers about the guided tour.
 *
 * localStorage rather than a server row, for the same reason the bottom-bar
 * preference lives there: it belongs to this person on this device and losing
 * it costs one repeated offer. See docs/OPEN-QUESTIONS G-3, which records this
 * as the default in use rather than an answered question — the store is the
 * only seam, so moving it to `/me` later is one file.
 *
 * `null` and `false` are different states throughout. "Never offered" is not
 * "offered and declined", and only the second one silences the invitation.
 */
interface GuideState {
  /** ISO timestamp of the run that reached the closing card. */
  completedAt: string | null;
  /** ISO timestamp of a "Not now". Silences the unprompted invitation. */
  dismissedAt: string | null;
  /**
   * Asked for on the sign-in screen, consumed on the next authenticated load.
   * The tour cannot run before there is a session to filter it by, so the
   * request has to survive the sign-in round trip somewhere.
   */
  armed: boolean;
  /**
   * Which step to open at, when the request came from an Updates row rather
   * than from the sign-in screen. `null` means start at the beginning.
   */
  armedFromStepId: string | null;
  /** Newest changelog release this person has opened. Drives the unread dot. */
  seenVersion: string | null;
  /**
   * Step *id*, never an index. A step inserted in the middle later must not
   * silently move somebody two steps backwards on resume.
   */
  lastStepId: string | null;
  /** ISO timestamp of the abandoned run, so a stale resume can be discarded. */
  lastStepAt: string | null;
  /** Bumped when the registry changes shape enough to invalidate a resume. */
  registryVersion: number | null;

  arm: (fromStepId?: string) => void;
  consumeArmed: () => void;
  markUpdatesSeen: (version: string) => void;
  dismiss: () => void;
  complete: (registryVersion: number) => void;
  recordStep: (stepId: string, registryVersion: number) => void;
  clearResume: () => void;
  /** Development affordance: forget everything and offer the tour again. */
  reset: () => void;
}

/** A resume older than this starts over instead. */
export const RESUME_WINDOW_DAYS = 7;

const EMPTY = {
  completedAt: null,
  dismissedAt: null,
  armed: false,
  armedFromStepId: null,
  seenVersion: null,
  lastStepId: null,
  lastStepAt: null,
  registryVersion: null,
} as const;

export const useGuideStore = create<GuideState>()(
  persist(
    (set) => ({
      ...EMPTY,

      arm: (fromStepId) => {
        set({ armed: true, armedFromStepId: fromStepId ?? null });
      },
      consumeArmed: () => {
        set({ armed: false, armedFromStepId: null });
      },
      markUpdatesSeen: (version) => {
        set({ seenVersion: version });
      },
      dismiss: () => {
        set({ dismissedAt: new Date().toISOString(), armed: false, armedFromStepId: null });
      },
      complete: (registryVersion) => {
        set({
          completedAt: new Date().toISOString(),
          armed: false,
          armedFromStepId: null,
          lastStepId: null,
          lastStepAt: null,
          registryVersion,
        });
      },
      recordStep: (stepId, registryVersion) => {
        set({ lastStepId: stepId, lastStepAt: new Date().toISOString(), registryVersion });
      },
      clearResume: () => {
        set({ lastStepId: null, lastStepAt: null });
      },
      reset: () => {
        set({ ...EMPTY });
      },
    }),
    { name: 'vyuha.guide' },
  ),
);

/**
 * Whether the tour should offer itself without being asked.
 *
 * Deliberately not "has it been completed" — a person who said "Not now" has
 * answered the question, and asking again on every sign-in is the behaviour
 * this check exists to prevent.
 */
export function shouldOfferUnprompted(state: {
  completedAt: string | null;
  dismissedAt: string | null;
}): boolean {
  return state.completedAt === null && state.dismissedAt === null;
}

/**
 * Whether an abandoned run is still worth offering to continue.
 *
 * A resume is thrown away when the registry has moved on, because the recorded
 * step id may no longer exist and "continue" would silently start from the top
 * while claiming otherwise.
 */
export function canResume(
  state: {
    lastStepId: string | null;
    lastStepAt: string | null;
    registryVersion: number | null;
  },
  currentRegistryVersion: number,
  now: number = Date.now(),
): boolean {
  if (!state.lastStepId || !state.lastStepAt) return false;
  if (state.registryVersion !== currentRegistryVersion) return false;

  const age = now - new Date(state.lastStepAt).getTime();
  if (Number.isNaN(age)) return false;

  return age <= RESUME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
