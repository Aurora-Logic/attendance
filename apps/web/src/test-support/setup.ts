import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Browser APIs jsdom does not implement, stubbed to the smallest thing that is
 * still honest.
 *
 * Each of these is used by a component under test, and jsdom leaving it out
 * would otherwise fail the render for a reason that has nothing to do with the
 * behaviour being tested.
 */

// The shell reads this on mount to decide between the sidebar and the bottom
// bar. Defaults to "no match", which is the desktop branch; a test that wants
// the phone overrides it with `setViewportMatches`.
let currentMatches = false;

export function setViewportMatches(matches: boolean): void {
  currentMatches = matches;
}

if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  const storageMock: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
  }
}

vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: currentMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

// The guided tour observes its anchor so the cutout follows a control that
// moves. jsdom has no layout, so this never fires — which is correct: nothing
// moves in a test.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {
      /* no layout in jsdom */
    }
    unobserve() {
      /* no layout in jsdom */
    }
    disconnect() {
      /* no layout in jsdom */
    }
  },
);

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {
      /* no layout in jsdom */
    }
    unobserve() {
      /* no layout in jsdom */
    }
    disconnect() {
      /* no layout in jsdom */
    }
    takeRecords() {
      return [];
    }
  },
);

/*
 * Base UI popovers want these; jsdom implements none of them.
 *
 * Assigned outright rather than with `??=`. The nullish-assignment form reads
 * the existing method to test it, which is exactly the unbound-method access
 * the lint rule exists to catch — and there is nothing to preserve here, since
 * jsdom has no pointer capture to begin with.
 */
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

/*
 * Base UI's ScrollArea asks its viewport what is animating, on a timer.
 *
 * jsdom has no Web Animations API, so the call throws from inside a `setTimeout`
 * — outside any test's stack, which Vitest reports as an uncaught exception and
 * a non-zero exit even though every assertion passed. Nothing is animating in
 * jsdom, so an empty list is the honest answer rather than a convenient one.
 */
Element.prototype.getAnimations = vi.fn(() => []);

afterEach(() => {
  cleanup();
  setViewportMatches(false);
  localStorage.clear();
});
