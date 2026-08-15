import { describe, expect, it } from 'vitest';

import type { LocationSummary } from '@vyuha/shared';

import {
  DEFAULT_GEOFENCE_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  geofencePatchSchema,
  officeChangeOf,
  officeDraftOf,
} from './office-location';

/**
 * The cases that decide whether an employee standing in the office is allowed
 * to punch: half a centre, a coordinate typed to more places than the field
 * can show, a radius nobody set. Each one is a way this panel could quietly
 * write the wrong thing, so each one is settled here rather than by clicking.
 */

function location(over: Partial<LocationSummary> = {}): LocationSummary {
  return {
    id: 'loc-1',
    name: 'Head Office',
    code: 'HO',
    address: null,
    timezone: null,
    geofenceLat: null,
    geofenceLng: null,
    geofenceRadiusM: 100,
    ipAllowlist: [],
    ...over,
  };
}

const CENTRED = location({ geofenceLat: 19.076, geofenceLng: 72.8777, geofenceRadiusM: 120 });

describe('the draft a location opens with', () => {
  it('shows a stored centre, with the radius that was chosen for it', () => {
    expect(officeDraftOf(CENTRED)).toEqual({
      locationId: 'loc-1',
      latitude: '19.076',
      longitude: '72.8777',
      radiusM: '120',
    });
  });

  it('offers 150 m when there is no centre, not the column default of 100', () => {
    // The stored 100 on a location with no centre is what the column ships
    // with, not a figure anybody chose - the radius does nothing until there
    // is a centre to measure from.
    expect(officeDraftOf(location())).toEqual({
      locationId: 'loc-1',
      latitude: '',
      longitude: '',
      radiusM: String(DEFAULT_GEOFENCE_RADIUS_M),
    });
  });
});

describe('deciding whether there is anything to save', () => {
  it('is clean when nothing has been touched', () => {
    expect(officeChangeOf(officeDraftOf(CENTRED), CENTRED)).toEqual({ kind: 'clean' });
  });

  it('is clean on a location that has never been geofenced, despite the 150', () => {
    // Otherwise the screen would open claiming an unsaved change, and offer to
    // write a radius nobody asked for onto a geofence that does not exist.
    const never = location();
    expect(officeChangeOf(officeDraftOf(never), never)).toEqual({ kind: 'clean' });
  });

  it('is clean when the stored centre is finer than the six places on screen', () => {
    // 19.07598371 renders as 19.075984. Comparing the raw numbers would report
    // an edit the moment the tab opened and then save a rounded value.
    const precise = location({ geofenceLat: 19.07598371, geofenceLng: 72.87765594 });
    expect(officeChangeOf(officeDraftOf(precise), precise)).toEqual({ kind: 'clean' });
  });

  it('sends the new centre with 150 m when a first geofence is set', () => {
    const fresh = location();
    const draft = { ...officeDraftOf(fresh), latitude: '19.076', longitude: '72.8777' };
    expect(officeChangeOf(draft, fresh)).toEqual({
      kind: 'dirty',
      values: { geofenceLat: 19.076, geofenceLng: 72.8777, geofenceRadiusM: 150 },
    });
  });

  it('sends a widened radius on its own', () => {
    const draft = { ...officeDraftOf(CENTRED), radiusM: '200' };
    expect(officeChangeOf(draft, CENTRED)).toEqual({
      kind: 'dirty',
      values: { geofenceLat: 19.076, geofenceLng: 72.8777, geofenceRadiusM: 200 },
    });
  });

  it('switches geofencing off when both coordinates are cleared', () => {
    const draft = { ...officeDraftOf(CENTRED), latitude: '', longitude: '' };
    expect(officeChangeOf(draft, CENTRED)).toEqual({
      kind: 'dirty',
      // The radius travels unchanged rather than being invented: with no
      // centre it does nothing either way, and rewriting it would show up in
      // the audit trail as a change somebody made.
      values: { geofenceLat: null, geofenceLng: null, geofenceRadiusM: 120 },
    });
  });
});

describe('refusing to send something the server would reject', () => {
  it('refuses half a centre, and says how to fix it', () => {
    const draft = { ...officeDraftOf(CENTRED), longitude: '' };
    const change = officeChangeOf(draft, CENTRED);
    expect(change.kind).toBe('invalid');
    if (change.kind === 'invalid') expect(change.message).toContain('clear both');
  });

  it('refuses half a centre the other way round', () => {
    const draft = { ...officeDraftOf(CENTRED), latitude: '' };
    expect(officeChangeOf(draft, CENTRED).kind).toBe('invalid');
  });

  it('refuses a latitude beyond the poles', () => {
    const draft = { ...officeDraftOf(CENTRED), latitude: '91' };
    expect(officeChangeOf(draft, CENTRED).kind).toBe('invalid');
  });

  it('refuses a longitude past the date line', () => {
    const draft = { ...officeDraftOf(CENTRED), longitude: '181' };
    expect(officeChangeOf(draft, CENTRED).kind).toBe('invalid');
  });

  it('refuses a coordinate left half typed', () => {
    // Number('-') is NaN, and Number('') is 0 - which would silently put the
    // office on the equator.
    expect(officeChangeOf({ ...officeDraftOf(CENTRED), latitude: '-' }, CENTRED).kind).toBe(
      'invalid',
    );
  });

  it('refuses a radius below the floor and above the ceiling', () => {
    expect(
      officeChangeOf({ ...officeDraftOf(CENTRED), radiusM: String(MIN_RADIUS_M - 1) }, CENTRED).kind,
    ).toBe('invalid');
    expect(
      officeChangeOf({ ...officeDraftOf(CENTRED), radiusM: String(MAX_RADIUS_M + 1) }, CENTRED).kind,
    ).toBe('invalid');
  });

  it('refuses a fractional radius', () => {
    expect(officeChangeOf({ ...officeDraftOf(CENTRED), radiusM: '150.5' }, CENTRED).kind).toBe(
      'invalid',
    );
  });

  it('refuses an emptied radius rather than reading it as zero', () => {
    expect(officeChangeOf({ ...officeDraftOf(CENTRED), radiusM: '' }, CENTRED).kind).toBe('invalid');
  });
});

describe('the bounds this screen states and the bounds the server enforces', () => {
  /**
   * The messages above quote MIN_RADIUS_M and MAX_RADIUS_M; the request is
   * parsed by `geofencePatchSchema`, which comes from the API's own
   * `updateLocationSchema`. If the server moves a bound and these constants
   * stay put, the panel would either refuse a value the server accepts or send
   * one it does not - so the two are checked against each other here rather
   * than being trusted to stay in step.
   */
  it('accepts exactly the radius range the field advertises', () => {
    const centre = { geofenceLat: 19.076, geofenceLng: 72.8777 };
    expect(geofencePatchSchema.safeParse({ ...centre, geofenceRadiusM: MIN_RADIUS_M }).success).toBe(
      true,
    );
    expect(geofencePatchSchema.safeParse({ ...centre, geofenceRadiusM: MAX_RADIUS_M }).success).toBe(
      true,
    );
    expect(
      geofencePatchSchema.safeParse({ ...centre, geofenceRadiusM: MIN_RADIUS_M - 1 }).success,
    ).toBe(false);
    expect(
      geofencePatchSchema.safeParse({ ...centre, geofenceRadiusM: MAX_RADIUS_M + 1 }).success,
    ).toBe(false);
  });

  it('accepts a cleared centre, which is how geofencing is switched off', () => {
    expect(
      geofencePatchSchema.safeParse({
        geofenceLat: null,
        geofenceLng: null,
        geofenceRadiusM: 150,
      }).success,
    ).toBe(true);
  });

  it('refuses a coordinate outside the world', () => {
    expect(
      geofencePatchSchema.safeParse({
        geofenceLat: 91,
        geofenceLng: 72.8777,
        geofenceRadiusM: 150,
      }).success,
    ).toBe(false);
  });

  it('carries no field this panel does not show', () => {
    // The point of picking three columns is that an absent field is unchanged
    // on the server. A schema that grew a fourth would let this screen
    // overwrite an IP allowlist it never rendered.
    expect(Object.keys(geofencePatchSchema.shape).sort()).toEqual([
      'geofenceLat',
      'geofenceLng',
      'geofenceRadiusM',
    ]);
  });
});
