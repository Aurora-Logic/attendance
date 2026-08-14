import { describe, expect, it } from 'vitest';

import {
  availableDays,
  compOffUrgency,
  daysBetween,
  expiringSoon,
  expiryNote,
} from './comp-off';
import type { CompOffCredit } from './types';

/**
 * REQ-G-11. The cases that matter are the boundaries of the two notification
 * thresholds and the states the server can be in that the screen must not
 * overstate — chiefly a credit whose expiry has passed but which the job has
 * not lapsed yet.
 */

function credit(overrides: Partial<CompOffCredit> = {}): CompOffCredit {
  return {
    id: 'c1',
    employee: { id: 'e1', name: 'Asha Rao' },
    leaveType: { id: 't1', name: 'Compensatory Off', code: 'CO' },
    earnedForDate: '2026-08-01',
    days: 1,
    expiresOn: '2026-08-31',
    consumedByLeaveRequestId: null,
    lapsedAt: null,
    createdAt: '2026-08-01T05:00:00.000Z',
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-08-14', '2026-08-21')).toBe(7);
    expect(daysBetween('2026-08-14', '2026-08-14')).toBe(0);
    expect(daysBetween('2026-08-21', '2026-08-14')).toBe(-7);
  });

  it('crosses a month and a leap day without drifting', () => {
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3);
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
  });

  it('is unaffected by a daylight-saving shift', () => {
    // The UK moves its clocks on 2026-03-29. Local-time subtraction across it
    // yields 6.958 days, which rounds a 7-day warning down to 6 and moves the
    // credit into the wrong band.
    expect(daysBetween('2026-03-26', '2026-04-02')).toBe(7);
  });

  it('refuses a value that is not a date rather than answering NaN', () => {
    expect(() => daysBetween('not-a-date', '2026-08-14')).toThrow(RangeError);
    expect(() => daysBetween('2026-8-14', '2026-08-14')).toThrow(RangeError);
    expect(() => daysBetween('2026-13-01', '2026-08-14')).toThrow(RangeError);
    expect(() => daysBetween('', '2026-08-14')).toThrow(RangeError);
  });
});

describe('compOffUrgency', () => {
  const today = '2026-08-14';

  it('is CONSUMED once a leave request used it, whatever the expiry says', () => {
    expect(
      compOffUrgency(credit({ consumedByLeaveRequestId: 'r1', expiresOn: '2026-08-15' }), today),
    ).toBe('CONSUMED');
  });

  it('is LAPSED only when the server lapsed it', () => {
    expect(compOffUrgency(credit({ lapsedAt: '2026-08-10T00:00:00Z' }), today)).toBe('LAPSED');
  });

  it('does not claim a credit has lapsed before the job has said so', () => {
    // Expiry yesterday, no lapsedAt: the balance still holds the days, so the
    // screen must not say "expired" and send somebody to argue with HR.
    expect(compOffUrgency(credit({ expiresOn: '2026-08-13' }), today)).toBe('CRITICAL');
    expect(expiryNote(credit({ expiresOn: '2026-08-13' }), today)).toBe('Past its expiry date.');
  });

  it('bands on the two thresholds the expiry job notifies at', () => {
    expect(compOffUrgency(credit({ expiresOn: '2026-08-16' }), today)).toBe('CRITICAL'); // 2 days
    expect(compOffUrgency(credit({ expiresOn: '2026-08-17' }), today)).toBe('SOON'); // 3 days
    expect(compOffUrgency(credit({ expiresOn: '2026-08-21' }), today)).toBe('SOON'); // 7 days
    expect(compOffUrgency(credit({ expiresOn: '2026-08-22' }), today)).toBe('ACTIVE'); // 8 days
  });
});

describe('expiryNote', () => {
  const today = '2026-08-14';

  it('says today and tomorrow rather than a count of zero or one', () => {
    expect(expiryNote(credit({ expiresOn: '2026-08-14' }), today)).toBe('Expires today.');
    expect(expiryNote(credit({ expiresOn: '2026-08-15' }), today)).toBe('Expires tomorrow.');
  });

  it('counts days beyond that', () => {
    expect(expiryNote(credit({ expiresOn: '2026-08-20' }), today)).toBe('Expires in 6 days.');
  });

  it('explains a settled credit rather than counting to its expiry', () => {
    expect(expiryNote(credit({ consumedByLeaveRequestId: 'r1' }), today)).toBe(
      'Used against a leave application.',
    );
    expect(expiryNote(credit({ lapsedAt: '2026-08-10T00:00:00Z' }), today)).toBe(
      'Expired before it was used.',
    );
  });
});

describe('expiringSoon', () => {
  it('takes only live credits inside the warning window, soonest first', () => {
    const rows = [
      credit({ id: 'far', expiresOn: '2026-09-30' }),
      credit({ id: 'week', expiresOn: '2026-08-20' }),
      credit({ id: 'days', expiresOn: '2026-08-15' }),
      credit({ id: 'used', expiresOn: '2026-08-15', consumedByLeaveRequestId: 'r1' }),
      credit({ id: 'gone', expiresOn: '2026-08-15', lapsedAt: '2026-08-15T00:00:00Z' }),
    ];
    expect(expiringSoon(rows, '2026-08-14').map((c) => c.id)).toEqual(['days', 'week']);
  });

  it('does not mutate the list it was given', () => {
    const rows = [credit({ id: 'b', expiresOn: '2026-08-20' }), credit({ id: 'a', expiresOn: '2026-08-15' })];
    expiringSoon(rows, '2026-08-14');
    expect(rows.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('is empty when nothing is close', () => {
    expect(expiringSoon([credit({ expiresOn: '2026-12-01' })], '2026-08-14')).toEqual([]);
  });
});

describe('availableDays', () => {
  it('sums live credits only', () => {
    expect(
      availableDays([
        credit({ days: 1 }),
        credit({ days: 0.5 }),
        credit({ days: 1, consumedByLeaveRequestId: 'r1' }),
        credit({ days: 1, lapsedAt: '2026-08-01T00:00:00Z' }),
      ]),
    ).toBe(1.5);
  });

  it('keeps half days exact rather than drifting in binary floating point', () => {
    // 0.1 + 0.2 is not 0.3 in a float; three half days must be 1.5 and not
    // 1.4999999999999998, which would render as a balance nobody can add up.
    expect(availableDays([credit({ days: 0.5 }), credit({ days: 0.5 }), credit({ days: 0.5 })])).toBe(1.5);
  });

  it('is zero for no credits', () => {
    expect(availableDays([])).toBe(0);
  });
});
