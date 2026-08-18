import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';

import { AppShell } from '@/app/layout/app-shell';
import { PageHeader } from '@/components/shared/page-header';
import { renderWithProviders } from '@/test-support/render-shell';
import { setViewportMatches } from '@/test-support/setup';
import { ROLE_PERMISSION_MATRIX, type SystemRoleName } from '@vyuha/shared';

import {
  ALL_STEPS,
  ANCHORS,
  anchorFor,
  resolvePageSteps,
  resolveSteps,
  SHELL_ANCHORS,
} from './tour-steps';

/**
 * The guided tour finds its targets through `data-guide` attributes on
 * ordinary controls. That coupling is weak by design — an attribute, not a
 * structure — but its failure mode is silent: a refactor drops an attribute,
 * the step is skipped at runtime, and nothing goes red.
 *
 * `scripts/check-guide-anchors.mjs` catches a *deleted* attribute by reading
 * the source. It cannot tell how many elements actually render, which is the
 * other half of the contract: a step whose selector matches two elements
 * highlights whichever the DOM happens to return first. That is what this
 * file is for.
 */

function renderShell(page = <PageHeader description="A test screen." />) {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={page} />
      </Route>
    </Routes>,
  );
}

function countAnchor(name: string): number {
  return document.querySelectorAll(`[data-guide="${name}"]`).length;
}

describe('guided tour anchors', () => {
  it('resolves every shell anchor to exactly one element on a desktop shell', () => {
    renderShell();

    for (const anchor of SHELL_ANCHORS) {
      expect(countAnchor(anchor), `[data-guide="${anchor}"]`).toBe(1);
    }
  });

  it('resolves every shell anchor to exactly one element on a phone', () => {
    // useIsMobile reads matchMedia, which swaps the account menu from a
    // dropdown to a sheet — two different elements carrying the same anchor,
    // and the one place a duplicate could plausibly appear.
    setViewportMatches(true);
    renderShell();

    for (const anchor of SHELL_ANCHORS) {
      expect(countAnchor(anchor), `[data-guide="${anchor}"]`).toBe(1);
    }
  });

  it('treats furniture anchors as optional rather than required', () => {
    // A screen legitimately has no table, or two. The shell test above asserts
    // singularity only for the anchors that are singular by construction; this
    // records that the rest are deliberately not in that set, so nobody
    // "fixes" the gap by adding them.
    const furniture = Object.values(ANCHORS).filter((a) => !SHELL_ANCHORS.includes(a));

    expect(furniture).toEqual([
      'screen.search',
      'screen.table',
      'screen.table-cards',
      'screen.pagination',
    ]);
  });

  it('names no anchor that the registry does not use', () => {
    const used = new Set(ALL_STEPS.flatMap((s) => [s.anchor, s.mobileAnchor].filter(Boolean)));

    for (const anchor of Object.values(ANCHORS)) {
      expect(used.has(anchor), `${anchor} is declared but no step uses it`).toBe(true);
    }
  });

  it('gives every step an anchor that is declared in ANCHORS', () => {
    const declared = new Set<string>(Object.values(ANCHORS));

    for (const step of ALL_STEPS) {
      expect(declared.has(step.anchor), `${step.id} -> ${step.anchor}`).toBe(true);
      if (step.mobileAnchor) {
        expect(declared.has(step.mobileAnchor), `${step.id} -> ${step.mobileAnchor}`).toBe(true);
      }
    }
  });
});

describe('guided tour length', () => {
  /*
   * A regression guard on a real bug, not a restatement of the registry.
   *
   * The tour once started before `SessionGate` had written the permission set,
   * froze a five-step list for an administrator entitled to twenty-one, and
   * silently filtered every screen step away as unpermitted. Nothing about the
   * code looked wrong. These numbers are what "it filtered correctly" means,
   * so a filter that silently empties itself fails here rather than in front
   * of somebody taking the tour.
   */
  const EXPECTED: Record<SystemRoleName, { desktop: number; phone: number }> = {
    Employee: { desktop: 8, phone: 7 },
    Operations: { desktop: 13, phone: 12 },
    HR: { desktop: 17, phone: 16 },
    Admin: { desktop: 21, phone: 20 },
    // The CRM roles hold no attendance keys (D-15: they sit beside Employee),
    // so the tour they get is the shell plus whatever the masters key unlocks.
    Sales: { desktop: 5, phone: 4 },
    'Sales manager': { desktop: 5, phone: 4 },
    Purchase: { desktop: 5, phone: 4 },
    Accounts: { desktop: 5, phone: 4 },
  };

  for (const [role, expected] of Object.entries(EXPECTED) as [
    SystemRoleName,
    { desktop: number; phone: number },
  ][]) {
    it(`gives ${role} ${String(expected.desktop)} steps on a desktop`, () => {
      const granted = new Set(ROLE_PERMISSION_MATRIX[role]);
      expect(resolveSteps(granted, false)).toHaveLength(expected.desktop);
    });

    it(`gives ${role} ${String(expected.phone)} steps on a phone`, () => {
      const granted = new Set(ROLE_PERMISSION_MATRIX[role]);
      // One fewer: the shortcut sheet is a desktop-only control, and its step
      // declares mobileBehaviour: 'skip' rather than pointing at nothing.
      expect(resolveSteps(granted, true)).toHaveLength(expected.phone);
    });
  }

  it('never offers a step whose permission the session lacks', () => {
    const granted = new Set(ROLE_PERMISSION_MATRIX.Employee);

    for (const step of resolveSteps(granted, false)) {
      if (step.permission) expect(granted.has(step.permission)).toBe(true);
    }
  });

  it('gives a session with no permissions the shell steps and nothing else', () => {
    const steps = resolveSteps(new Set(), false);

    expect(steps.every((s) => !s.permission)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe('the per-screen guide', () => {
  const admin = new Set(ROLE_PERMISSION_MATRIX.Admin);
  const present = (anchors: string[]) => (a: string) => anchors.includes(a);

  it('answers "what is this screen" without walking the whole product', () => {
    /*
     * The complaint this scope exists to answer: reaching Approvals in the
     * whole-product tour costs sixteen steps, and somebody standing on
     * Approvals wanting to know what it does should pay none of them.
     */
    const whole = resolveSteps(admin, false);
    const stepsToReachIt = whole.findIndex((s) => s.id === 'screen.approvals') + 1;
    const page = resolvePageSteps('/approvals', admin, false, present([]));

    // Asserted as a relationship rather than a literal, so adding a screen
    // does not fail this for the wrong reason. Today it is 10 against 1.
    expect(stepsToReachIt).toBeGreaterThan(5);
    expect(page.length).toBeLessThan(stepsToReachIt);
    expect(page[0]?.id).toBe('screen.approvals');
  });

  it('includes only the furniture the screen actually renders', () => {
    const bare = resolvePageSteps('/approvals', admin, false, present([]));
    const withTable = resolvePageSteps('/approvals', admin, false, present(['screen.table']));
    const full = resolvePageSteps(
      '/employees',
      admin,
      false,
      present(['screen.search', 'screen.table', 'screen.pagination']),
    );

    expect(bare.map((s) => s.id)).toEqual(['screen.approvals']);
    expect(withTable.map((s) => s.id)).toEqual(['screen.approvals', 'furniture.table']);
    expect(full.map((s) => s.id)).toEqual([
      'screen.employees',
      'furniture.search',
      'furniture.table',
      'furniture.pagination',
    ]);
  });

  it('keeps furniture out of the whole-product tour', () => {
    // Sixteen screens each repeating "this is the table" is what would make
    // the long tour unbearable, so furniture belongs to the page scope only.
    expect(resolveSteps(admin, false).some((s) => s.furniture)).toBe(false);
  });

  it('gives nothing for a route the tour does not introduce', () => {
    expect(resolvePageSteps('/profile', admin, false, present(['screen.table']))).toEqual([]);
    expect(resolvePageSteps('/nonsense', admin, false, present([]))).toEqual([]);
  });

  it('refuses a screen the session cannot open', () => {
    const employee = new Set(ROLE_PERMISSION_MATRIX.Employee);

    expect(resolvePageSteps('/audit', employee, false, present(['screen.table']))).toEqual([]);
    expect(resolvePageSteps('/punch', employee, false, present([])).map((s) => s.id)).toEqual([
      'screen.punch',
    ]);
  });

  it('points the table step at the card list on a phone', () => {
    const desktop = resolvePageSteps('/employees', admin, false, present(['screen.table']));
    const phone = resolvePageSteps('/employees', admin, true, present(['screen.table']));

    const desktopTable = desktop.find((s) => s.id === 'furniture.table');
    const phoneTable = phone.find((s) => s.id === 'furniture.table');

    expect(desktopTable).toBeDefined();
    expect(phoneTable).toBeDefined();
    // The desktop table and the phone's card list are separate elements, both
    // always in the DOM with CSS deciding which is visible — so the guide has
    // to choose by width rather than by presence.
    expect(desktopTable && anchorFor(desktopTable, false)).toBe('screen.table');
    expect(phoneTable && anchorFor(phoneTable, true)).toBe('screen.table-cards');
  });
});
