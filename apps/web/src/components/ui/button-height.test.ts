import { describe, expect, it } from 'vitest';

/**
 * A screen does not decide how tall a button is on a phone.
 *
 * The Button primitive draws every size at its desktop height and the coarse-
 * pointer floor in index.css raises it to 44px, the same floor every field,
 * select and menu row stands on. Before this test, seventeen call sites had
 * added `pointer-coarse:min-h-11` or `size-11` to their own buttons because
 * the primitive did not, and the result was a phone on which the dispatch
 * dialog's buttons were 44px, the leave page's 28px and the shell's 32px.
 * Fixing the primitive removed the overrides; this keeps them from coming
 * back one screen at a time, which is how they arrived.
 *
 * Sources are read through Vite's glob so the test needs no Node typings in
 * the browser-typed app config.
 */
const SOURCES = import.meta.glob<string>(
  ['/src/app/**/*.tsx', '/src/components/shared/**/*.tsx', '/src/features/**/*.tsx', '!**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

/**
 * Controls that are deliberately not button-height, each for a reason the
 * screen states in place: the 64px punch photo thumbnail, the calculator
 * keypad's 44px keys on every pointer, the profile page's multi-line fold
 * rows, and the punch page's 56px hero action.
 */
const ALLOWED = new Set([
  '/src/features/attendance/day-punches.tsx',
  '/src/features/calculator/calculator-panel.tsx',
  '/src/features/profile/profile-page.tsx',
  '/src/features/punch/punch-page.tsx',
  '/src/features/documents/design-rail.tsx',
]);

const HEIGHT_OVERRIDE = /(^|\s)(h-\d+|min-h-\S+|size-\d+|pointer-coarse:(h|min-h|size|after)[:-]\S*)(?=\s|$)/;
const BUTTON_TAG = /<Button\b[^>]*?>/gs;
const CLASS_NAME = /className="([^"]*)"/;

describe('Button height is owned by the primitive', () => {
  it('no screen sets a height, size or coarse-pointer growth on a Button', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      if (ALLOWED.has(file)) continue;
      for (const tag of source.match(BUTTON_TAG) ?? []) {
        const classes = CLASS_NAME.exec(tag)?.[1];
        if (classes && HEIGHT_OVERRIDE.test(classes)) {
          const line = source.slice(0, source.indexOf(tag)).split('\n').length;
          offenders.push(`${file}:${line} ${classes}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans the screens at all', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });
});
