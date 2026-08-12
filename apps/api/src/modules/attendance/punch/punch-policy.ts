import { CLOCK_SKEW_FLAG_SECONDS, type PunchType } from '@vyuha/shared';

/**
 * Every decision the punch endpoint makes that does not need the database, as
 * pure functions.
 *
 * They are here rather than inline in the service for the reason `compute-day.ts`
 * gives about the day engine: these are the rules an auditor would ask about --
 * how far outside a geofence is "outside", when a clock is wrong enough to
 * matter, which day a two-in-the-morning punch belongs to -- and each boundary
 * in them should be a row in a table-driven test rather than something only an
 * integration test with a fixture can reach.
 *
 * Nothing here reads the clock. `now` is always an argument, so a test can sit
 * exactly on a boundary instead of near one.
 */

const MS_PER_MINUTE = 60_000;

/** The REQ-C-01 grace columns, which are all the window needs. */
export interface WindowPolicy {
  readonly graceInBefore: number;
  readonly graceInAfter: number;
  readonly graceOutBefore: number;
  readonly graceOutAfter: number;
}

export interface PunchWindow {
  readonly opens: Date;
  readonly closes: Date;
}

function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}

/**
 * REQ-D-06. Which window this punch had to land in.
 *
 * Deliberately not the union of the two: `grace_in_after` bounds an IN and
 * `grace_out_before` bounds an OUT, and a single combined window would accept
 * an IN punch at going-home time. The same split the day engine applies in
 * `punchWindow` there -- one rule, two callers.
 */
export function windowFor(
  policy: WindowPolicy,
  scheduledIn: Date,
  scheduledOut: Date,
  type: PunchType,
): PunchWindow {
  return type === 'IN'
    ? {
        opens: addMinutes(scheduledIn, -policy.graceInBefore),
        closes: addMinutes(scheduledIn, policy.graceInAfter),
      }
    : {
        opens: addMinutes(scheduledOut, -policy.graceOutBefore),
        closes: addMinutes(scheduledOut, policy.graceOutAfter),
      };
}

/** Inclusive at both ends: a punch exactly on the closing minute is inside. */
export function isWithinWindow(window: PunchWindow, at: Date): boolean {
  return at.getTime() >= window.opens.getTime() && at.getTime() <= window.closes.getTime();
}

// ------------------------------------------------------------------ geofence

export interface GeofenceCentre {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number;
}

export interface LocationReading {
  readonly latitude: number;
  readonly longitude: number;
  /** Null when the device reported a fix without an accuracy estimate. */
  readonly accuracyM: number | null;
}

export type GeofenceVerdict =
  /** OPEN-QUESTIONS item 1: no centre supplied, so nothing was checked. */
  | { readonly kind: 'not_configured' }
  /** REQ-D-08a: permission denied or no fix. */
  | { readonly kind: 'no_reading' }
  | { readonly kind: 'inside'; readonly distanceM: number }
  /** Outside the radius, but not by more than the fix's own uncertainty. */
  | { readonly kind: 'tolerated'; readonly distanceM: number }
  | { readonly kind: 'outside'; readonly distanceM: number };

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the equirectangular approximation: at a 100 m radius
 * the two agree to well under a metre, but haversine is correct everywhere and
 * the approximation quietly is not near the poles or across the date line. The
 * cost is two extra trigonometric calls per punch.
 */
export function distanceMetres(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const dLat = toRadians(toLatitude - fromLatitude);
  const dLng = toRadians(toLongitude - fromLongitude);
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * REQ-D-08, including the sentence that matters most in it: "Block only when
 * `distance - gps_accuracy_m > radius`. A low-confidence fix gets the benefit
 * of the doubt ... Without this, people standing inside the building get
 * refused, because indoor GPS regularly degrades to 50-100 m."
 *
 * A missing accuracy is treated as zero rather than as infinite tolerance. A
 * device that will not say how sure it is has not earned the benefit of the
 * doubt, and treating silence as a wide margin would be a one-field bypass of
 * the whole control.
 */
export function evaluateGeofence(
  centre: GeofenceCentre | null,
  reading: LocationReading | null,
): GeofenceVerdict {
  if (centre === null) return { kind: 'not_configured' };
  if (reading === null) return { kind: 'no_reading' };

  const distanceM = distanceMetres(
    reading.latitude,
    reading.longitude,
    centre.latitude,
    centre.longitude,
  );

  if (distanceM <= centre.radiusM) return { kind: 'inside', distanceM };

  const tolerance = reading.accuracyM ?? 0;
  return distanceM - tolerance > centre.radiusM
    ? { kind: 'outside', distanceM }
    : { kind: 'tolerated', distanceM };
}

// ------------------------------------------------------------------- clock

/**
 * REQ-D-05. Signed, so the trail distinguishes a phone that is running fast
 * from one running slow -- and, on a queued punch, a positive value is the time
 * it spent waiting for a network rather than a wrong clock.
 */
export function clockSkewSeconds(serverTime: Date, clientTime: Date): number {
  return Math.round((serverTime.getTime() - clientTime.getTime()) / 1000);
}

export function isClockSkewed(seconds: number): boolean {
  return Math.abs(seconds) > CLOCK_SKEW_FLAG_SECONDS;
}

// ------------------------------------------------------------- ip allowlist

/**
 * Express reports an IPv4 client over an IPv6 socket as `::ffff:127.0.0.1`,
 * which matches no allowlist entry anybody would think to write. Comparing the
 * unnormalised form is how an allowlist ends up rejecting the office.
 */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/**
 * REQ-D-09. An exact literal, or an IPv4 CIDR block for an office on a /24.
 *
 * IPv6 is matched literally only. A residential IPv6 prefix changes often
 * enough that a CIDR entry would be a false sense of a control, and no office
 * in this deployment is reached over IPv6 today -- when one is, this is where
 * the prefix comparison goes, with its own tests.
 */
export function isIpAllowed(allowlist: readonly string[], ip: string | null): boolean {
  if (ip === null) return false;

  const candidate = ipv4ToNumber(ip);

  for (const raw of allowlist) {
    const entry = normaliseIp(raw);
    if (entry === null) continue;
    if (entry === ip) return true;

    const slash = entry.indexOf('/');
    if (slash < 0 || candidate === null) continue;

    const network = ipv4ToNumber(entry.slice(0, slash));
    // The prefix must be one or two literal digits. Number('') is 0, so a
    // trailing slash with nothing after it -- "203.0.113.0/" -- would slip
    // through a plain range check as /0 and match every address on the
    // internet. A typo in a settings screen must narrow the allowlist, never
    // widen it.
    const prefixText = entry.slice(slash + 1);
    if (!/^\d{1,2}$/u.test(prefixText)) continue;
    const bits = Number(prefixText);
    if (network === null || bits > 32) continue;

    // `<<` is a 32-bit signed operation in JavaScript, so a /0 mask written as
    // `-1 << 32` would come back as -1 rather than 0. The multiply keeps the
    // arithmetic in the safe-integer range where the octet sum already lives.
    const size = 2 ** (32 - bits);
    if (Math.floor(candidate / size) === Math.floor(network / size)) return true;
  }

  return false;
}

// ------------------------------------------------------- date attribution

/**
 * One calendar date a punch might belong to, with everything needed to decide.
 *
 * REQ-C-02 attributes a night shift to its *start* date, so an OUT punch at
 * 02:00 belongs to yesterday. Attribution is decided once, here, at punch time
 * -- the day engine reads `attendance_date` rather than re-deriving it, and two
 * places deciding which day a punch belongs to is two places to disagree.
 */
export interface DateCandidate {
  readonly date: string;
  readonly scheduledIn: Date;
  readonly scheduledOut: Date;
  readonly policy: WindowPolicy;
  /** An IN is already recorded for this date and no OUT has closed it. */
  readonly hasOpenIn: boolean;
}

/**
 * Which date this punch is attributed to, given the candidates in preference
 * order (today first, then the day before).
 *
 * An OUT that closes an open IN wins over a window match, and that ordering is
 * the whole point: somebody who worked a night shift and punches out at 06:30,
 * half an hour past the window, is closing yesterday's day. Attributing that to
 * today would leave yesterday permanently PENDING and open today with an OUT
 * that has no IN -- two broken days from one late punch.
 */
export function chooseAttendanceDate(
  candidates: readonly DateCandidate[],
  type: PunchType,
  now: Date,
): string {
  const fallback = candidates[0];
  if (fallback === undefined) {
    throw new Error('chooseAttendanceDate needs at least one candidate date.');
  }

  const matchesWindow = (candidate: DateCandidate): boolean =>
    isWithinWindow(
      windowFor(candidate.policy, candidate.scheduledIn, candidate.scheduledOut, type),
      now,
    );

  if (type === 'OUT') {
    return (
      candidates.find((candidate) => candidate.hasOpenIn && matchesWindow(candidate))?.date ??
      candidates.find((candidate) => candidate.hasOpenIn)?.date ??
      candidates.find(matchesWindow)?.date ??
      fallback.date
    );
  }

  // An IN never joins a date that already has one open: REQ-D-01 rejects that
  // punch, and it must be rejected against the day the employee is actually on
  // rather than quietly re-attributed to a neighbouring date.
  return (
    candidates.find((candidate) => !candidate.hasOpenIn && matchesWindow(candidate))?.date ??
    candidates.find(matchesWindow)?.date ??
    fallback.date
  );
}
