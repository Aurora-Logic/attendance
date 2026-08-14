import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { DayDetailSheet } from './day-detail-sheet';
import type { AttendanceDay } from './types';

/**
 * REQ-F-01's in-context entry point.
 *
 * The decision log says a missing OUT punch leaves the day "Pending until
 * regularized", and the day sheet is where a person actually notices that. Two
 * things could regress silently: which days offer the control at all —
 * offering it on a clean PRESENT day would invite editing attendance that
 * nothing went wrong with — and which kind it pre-selects, because a wrong
 * kind sends the employee to a form asking for the time they *arrived* when it
 * was the departure that was missed.
 *
 * The permission branch is deliberately not tested here. Every seeded role
 * inherits `regularization.raise` from the Employee bundle, so a role-based
 * probe could only ever assert the control is present — a check that cannot
 * fail is worse than no check. The server's own 403 is asserted in
 * `regularization.endpoints.test.ts`.
 */

function day(overrides: Partial<AttendanceDay>): AttendanceDay {
  return {
    id: 'd1',
    employee: { id: 'e1', name: 'Test User' },
    date: '2026-08-12',
    status: 'PRESENT',
    shiftName: 'General',
    scheduledIn: '09:00',
    scheduledOut: '18:00',
    firstIn: '2026-08-12T03:35:00.000Z',
    lastOut: '2026-08-12T13:00:00.000Z',
    workedMinutes: 505,
    otMinutes: 0,
    lateMinutes: 5,
    earlyExitMinutes: 0,
    flags: [],
    ...overrides,
  };
}

function correctionLink(): HTMLAnchorElement | null {
  return screen.queryByRole('link', { name: /correct this day/iu });
}

describe('offering a correction from the day sheet (REQ-F-01)', () => {
  it('offers nothing on a clean present day', () => {
    renderWithProviders(<DayDetailSheet day={day({})} onOpenChange={() => undefined} />);
    expect(correctionLink()).toBeNull();
  });

  it('offers nothing on a weekly off, which is not a broken day', () => {
    renderWithProviders(
      <DayDetailSheet
        day={day({ status: 'WEEKLY_OFF', firstIn: null, lastOut: null, workedMinutes: 0 })}
        onOpenChange={() => undefined}
      />,
    );
    expect(correctionLink()).toBeNull();
  });

  it('offers a missing out punch on the stuck day the pilot hits', () => {
    // REQ-E-02's PENDING: an IN exists, the OUT does not, the window closed.
    renderWithProviders(
      <DayDetailSheet
        day={day({ status: 'PENDING', lastOut: null, workedMinutes: 0, flags: ['missing_punch'] })}
        onOpenChange={() => undefined}
      />,
    );

    const link = correctionLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/regularizations?date=2026-08-12&kind=MISSING_OUT');
  });

  it('offers a missing in punch when it is the arrival that is absent', () => {
    renderWithProviders(
      <DayDetailSheet
        day={day({ firstIn: null, flags: ['missing_punch'] })}
        onOpenChange={() => undefined}
      />,
    );
    expect(correctionLink()?.getAttribute('href')).toContain('kind=MISSING_IN');
  });

  it('offers a forgotten day when neither punch exists', () => {
    renderWithProviders(
      <DayDetailSheet
        day={day({
          status: 'ABSENT',
          firstIn: null,
          lastOut: null,
          workedMinutes: 0,
          flags: ['missing_punch'],
        })}
        onOpenChange={() => undefined}
      />,
    );
    expect(correctionLink()?.getAttribute('href')).toContain('kind=FORGOT_TO_PUNCH');
  });

  it('carries the day being viewed, not today', () => {
    // The prefill is the whole point of the control; a link that dropped the
    // date would land on an empty form and look like it had simply navigated.
    renderWithProviders(
      <DayDetailSheet
        day={day({ date: '2026-07-03', status: 'PENDING', lastOut: null })}
        onOpenChange={() => undefined}
      />,
    );
    expect(correctionLink()?.getAttribute('href')).toContain('date=2026-07-03');
  });
});
