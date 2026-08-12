import { describe, expect, it } from 'vitest';

import { addDays, localDateIn } from '../day-engine/calendar-date.js';
import {
  chooseAttendanceDate,
  clockSkewSeconds,
  distanceMetres,
  evaluateGeofence,
  isClockSkewed,
  isIpAllowed,
  isWithinWindow,
  normaliseIp,
  windowFor,
  type DateCandidate,
  type WindowPolicy,
} from './punch-policy.js';

/**
 * The punch rules, at their boundaries.
 *
 * Every case here is one an auditor could ask about -- "how far outside is
 * outside", "whose day is a two-in-the-morning punch" -- and each is written
 * so it fails for exactly one reason. The integration suite drives the same
 * rules over HTTP; this one is where the arithmetic is pinned down.
 */

/** REQ-C-01's defaults, which are what an unconfigured shift carries. */
const POLICY: WindowPolicy = {
  graceInBefore: 30,
  graceInAfter: 10,
  graceOutBefore: 10,
  graceOutAfter: 120,
};

const IN_AT = new Date('2026-08-12T09:30:00+05:30');
const OUT_AT = new Date('2026-08-12T18:30:00+05:30');

const at = (iso: string): Date => new Date(iso);

describe('the punch window (REQ-D-06)', () => {
  it('bounds an IN and an OUT differently rather than taking the union', () => {
    const inWindow = windowFor(POLICY, IN_AT, OUT_AT, 'IN');
    const outWindow = windowFor(POLICY, IN_AT, OUT_AT, 'OUT');

    expect(inWindow.opens.toISOString()).toBe(at('2026-08-12T09:00:00+05:30').toISOString());
    expect(inWindow.closes.toISOString()).toBe(at('2026-08-12T09:40:00+05:30').toISOString());
    expect(outWindow.opens.toISOString()).toBe(at('2026-08-12T18:20:00+05:30').toISOString());
    expect(outWindow.closes.toISOString()).toBe(at('2026-08-12T20:30:00+05:30').toISOString());

    // The union would accept an IN punch at going-home time. This is the
    // assertion that says it does not.
    expect(isWithinWindow(inWindow, at('2026-08-12T18:25:00+05:30'))).toBe(false);
  });

  it.each([
    ['one second before it opens', '2026-08-12T08:59:59+05:30', false],
    ['exactly as it opens', '2026-08-12T09:00:00+05:30', true],
    ['in the middle', '2026-08-12T09:20:00+05:30', true],
    ['exactly as it closes', '2026-08-12T09:40:00+05:30', true],
    ['one second after it closes', '2026-08-12T09:40:01+05:30', false],
  ])('is inclusive at both ends: %s', (_label, instant, expected) => {
    expect(isWithinWindow(windowFor(POLICY, IN_AT, OUT_AT, 'IN'), at(instant))).toBe(expected);
  });
});

describe('geofence distance (REQ-D-08)', () => {
  it('measures a known separation to within a metre', () => {
    // One ten-thousandth of a degree of latitude is 11.1 m anywhere on Earth.
    expect(distanceMetres(19.076, 72.8777, 19.0761, 72.8777)).toBeCloseTo(11.1, 0);
    expect(distanceMetres(19.076, 72.8777, 19.076, 72.8777)).toBe(0);
  });

  it('is symmetric, so which point is "the office" cannot change the answer', () => {
    const there = distanceMetres(19.076, 72.8777, 19.0885, 72.8777);
    const back = distanceMetres(19.0885, 72.8777, 19.076, 72.8777);
    expect(there).toBeCloseTo(back, 6);
  });
});

describe('the geofence verdict (REQ-D-08, REQ-D-08a)', () => {
  const centre = { latitude: 19.076, longitude: 72.8777, radiusM: 100 };

  it('reports "not configured" rather than "inside" when no centre is set', () => {
    // The distinction is the whole point of OPEN-QUESTIONS item 1: a punch that
    // was never checked must not be recorded as one that passed.
    expect(evaluateGeofence(null, { latitude: 0, longitude: 0, accuracyM: 5 })).toEqual({
      kind: 'not_configured',
    });
  });

  it('reports "no reading" when the device gave no fix', () => {
    expect(evaluateGeofence(centre, null)).toEqual({ kind: 'no_reading' });
  });

  it('accepts a fix inside the radius', () => {
    const verdict = evaluateGeofence(centre, {
      latitude: 19.0765,
      longitude: 72.8777,
      accuracyM: 5,
    });
    expect(verdict.kind).toBe('inside');
  });

  it('tolerates a poor fix that is only outside by less than its own accuracy', () => {
    // 130 m out with an 80 m error: 130 - 80 = 50, which is inside 100.
    // REQ-D-08: "A low-confidence fix gets the benefit of the doubt."
    const verdict = evaluateGeofence(centre, {
      latitude: 19.07717,
      longitude: 72.8777,
      accuracyM: 80,
    });
    expect(verdict.kind).toBe('tolerated');
  });

  it('blocks the same position once the device claims to be sure of it', () => {
    // The control case for the test above: identical coordinates, a confident
    // fix. If tolerance were applied unconditionally, both would be tolerated.
    const verdict = evaluateGeofence(centre, {
      latitude: 19.07717,
      longitude: 72.8777,
      accuracyM: 5,
    });
    expect(verdict.kind).toBe('outside');
  });

  it('treats a missing accuracy as zero, not as unlimited tolerance', () => {
    // A device that will not say how sure it is has not earned the benefit of
    // the doubt; the alternative is a one-field bypass of the whole control.
    const verdict = evaluateGeofence(centre, {
      latitude: 19.07717,
      longitude: 72.8777,
      accuracyM: null,
    });
    expect(verdict.kind).toBe('outside');
  });

  it('treats exactly on the radius as inside', () => {
    // The radius is set to the measured distance of the point itself, so the
    // comparison under test is genuine equality. The first version hardcoded
    // 111 m for 0.001 degrees of latitude; the true great-circle distance is
    // about 111.2 m, so that probe was testing "slightly outside" while
    // claiming to test the boundary, and failed against correct code.
    const fix = { latitude: 19.077, longitude: 72.8777, accuracyM: 0 };
    // Same argument order as evaluateGeofence itself (reading, then centre),
    // so the two computations are bit-identical and the equality is exact.
    const exact = distanceMetres(fix.latitude, fix.longitude, centre.latitude, centre.longitude);
    const onEdge = evaluateGeofence({ ...centre, radiusM: exact }, fix);
    expect(onEdge.kind).toBe('inside');

    // And one hair past it, with a confident fix, is not.
    const past = evaluateGeofence({ ...centre, radiusM: exact - 0.001 }, fix);
    expect(past.kind).toBe('outside');
  });
});

describe('clock skew (REQ-D-05)', () => {
  it('is signed, so a fast phone and a slow one are distinguishable', () => {
    const server = at('2026-08-12T12:00:00Z');
    expect(clockSkewSeconds(server, at('2026-08-12T11:59:00Z'))).toBe(60);
    expect(clockSkewSeconds(server, at('2026-08-12T12:01:00Z'))).toBe(-60);
  });

  it.each([
    [299, false],
    [300, false],
    [301, true],
    [-301, true],
  ])('flags %i seconds: %s', (seconds, expected) => {
    // "more than 5 minutes", so exactly five minutes is not flagged.
    expect(isClockSkewed(seconds)).toBe(expected);
  });
});

describe('the IP allowlist (REQ-D-09)', () => {
  it('normalises the IPv4-mapped form Express reports over an IPv6 socket', () => {
    expect(normaliseIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normaliseIp('  203.0.113.4 ')).toBe('203.0.113.4');
    expect(normaliseIp('')).toBeNull();
    expect(normaliseIp(null)).toBeNull();
  });

  it('matches a literal address and a CIDR block', () => {
    expect(isIpAllowed(['203.0.113.4'], '203.0.113.4')).toBe(true);
    expect(isIpAllowed(['203.0.113.0/24'], '203.0.113.199')).toBe(true);
    expect(isIpAllowed(['203.0.113.0/24'], '203.0.114.1')).toBe(false);
    expect(isIpAllowed(['203.0.113.0/32'], '203.0.113.0')).toBe(true);
  });

  it('refuses everything when there is no address to compare', () => {
    // An unknown client address must not pass a configured allowlist.
    expect(isIpAllowed(['203.0.113.0/24'], null)).toBe(false);
  });

  it('refuses rather than throwing on a malformed entry', () => {
    // A typo in a settings screen must narrow the allowlist, never widen it.
    expect(isIpAllowed(['not-an-ip', '203.0.113.0/99', '203.0.113.0/'], '203.0.113.4')).toBe(false);
  });

  it('handles a /0 entry without the 32-bit shift wrapping round', () => {
    // `-1 << 32` is -1 in JavaScript, which would make a /0 mask match nothing
    // rather than everything.
    expect(isIpAllowed(['0.0.0.0/0'], '203.0.113.4')).toBe(true);
  });
});

describe('attendance date attribution (REQ-C-02)', () => {
  const dayShift = (date: string, hasOpenIn: boolean): DateCandidate => ({
    date,
    scheduledIn: new Date(`${date}T09:30:00+05:30`),
    scheduledOut: new Date(`${date}T18:30:00+05:30`),
    policy: POLICY,
    hasOpenIn,
  });

  const nightShift = (date: string, hasOpenIn: boolean): DateCandidate => ({
    date,
    scheduledIn: new Date(`${date}T22:00:00+05:30`),
    scheduledOut: new Date(`${addDays(date, 1)}T06:00:00+05:30`),
    policy: POLICY,
    hasOpenIn,
  });

  it('puts an ordinary morning IN on today', () => {
    const chosen = chooseAttendanceDate(
      [dayShift('2026-08-12', false), dayShift('2026-08-11', false)],
      'IN',
      at('2026-08-12T09:32:00+05:30'),
    );
    expect(chosen).toBe('2026-08-12');
  });

  it('attributes a night shift OUT at 02:00 to the day the shift started', () => {
    const chosen = chooseAttendanceDate(
      [nightShift('2026-08-13', false), nightShift('2026-08-12', true)],
      'OUT',
      at('2026-08-13T02:10:00+05:30'),
    );
    expect(chosen).toBe('2026-08-12');
  });

  it('still closes yesterday when the OUT is late enough to miss its window', () => {
    // 07:00 is past 06:00 + 120 minutes of grace, so no window matches. An open
    // IN outranks a window match precisely so this does not open a second,
    // broken day.
    const chosen = chooseAttendanceDate(
      [nightShift('2026-08-13', false), nightShift('2026-08-12', true)],
      'OUT',
      at('2026-08-13T08:30:00+05:30'),
    );
    expect(chosen).toBe('2026-08-12');
  });

  it('prefers the later date when both have an open IN', () => {
    const chosen = chooseAttendanceDate(
      [nightShift('2026-08-13', true), nightShift('2026-08-12', true)],
      'OUT',
      at('2026-08-13T23:00:00+05:30'),
    );
    expect(chosen).toBe('2026-08-13');
  });

  it('does not move an IN onto a date that already has one open', () => {
    // Rejecting the second IN is REQ-D-01's job, and it has to reject it
    // against the day the employee is actually on rather than have it quietly
    // land on the neighbouring date.
    const chosen = chooseAttendanceDate(
      [dayShift('2026-08-12', true), dayShift('2026-08-11', false)],
      'IN',
      at('2026-08-12T09:32:00+05:30'),
    );
    expect(chosen).toBe('2026-08-12');
  });

  it('falls back to the first candidate when nothing matches', () => {
    const chosen = chooseAttendanceDate(
      [dayShift('2026-08-12', false), dayShift('2026-08-11', false)],
      'IN',
      at('2026-08-12T03:00:00+05:30'),
    );
    expect(chosen).toBe('2026-08-12');
  });

  it('refuses to guess with no candidates at all', () => {
    expect(() => chooseAttendanceDate([], 'IN', new Date())).toThrow(/at least one candidate/u);
  });
});

describe('calendar helpers', () => {
  it('crosses a month end and a leap day', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('reads the local date in the location zone, not the server zone', () => {
    // 20:00 UTC is already the next day in Kolkata. A server in London would
    // otherwise attribute the punch to the wrong attendance date.
    const instant = new Date('2026-08-12T20:00:00Z');
    expect(localDateIn(instant, 'Asia/Kolkata')).toBe('2026-08-13');
    expect(localDateIn(instant, 'UTC')).toBe('2026-08-12');
  });
});
