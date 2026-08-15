import { formatCoordinate } from '@/features/org-masters/maps-link';
import { updateLocationSchema, type LocationSummary } from '@vyuha/shared';

/**
 * The office geofence, as Settings edits it (REQ-D-08).
 *
 * The centre is a column on a `locations` row, not on the organisation, so
 * this panel edits a location through `PATCH /locations/:id` — the same route,
 * the same validation and the same audit entry as Organisation → Locations.
 * Settings is only a second door onto it, because "where is our office" is not
 * a question anybody expects to answer three levels inside a master list.
 *
 * Everything here is pure: the strings the fields hold, the numbers the server
 * takes, and the one comparison that decides whether there is anything to
 * send. Pure so the awkward cases — half a centre, a coordinate left as "19.",
 * a radius outside its bounds — are settled by a test rather than by clicking.
 */

/**
 * What the radius field starts at when a centre is set here for the first
 * time: 150 m, not the 100 the column defaults to.
 *
 * A phone indoors is routinely 30–50 m out. The punch already subtracts the
 * accuracy the device reports before refusing anybody (REQ-D-08), but a tight
 * radius on top of a poor fix still refuses somebody standing in the office,
 * and the employee it happens to has no way of telling that from a bug.
 */
export const DEFAULT_GEOFENCE_RADIUS_M = 150;

/**
 * The bounds `updateLocationSchema` states, restated only so the field can say
 * what it wants in words. `geofencePatchSchema` is what actually decides, and
 * `office-location.test.ts` fails if these two ever disagree.
 */
export const MIN_RADIUS_M = 10;
export const MAX_RADIUS_M = 10_000;

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * The request body, taken from the server's own schema rather than written out
 * again. Three columns and no more: `PATCH /locations/:id` treats an absent
 * field as unchanged, so the name, the timezone and the IP allowlist are left
 * out — not echoed back — and this screen cannot overwrite a value it never
 * showed with a copy it read some seconds ago.
 */
export const geofencePatchSchema = updateLocationSchema.pick({
  geofenceLat: true,
  geofenceLng: true,
  geofenceRadiusM: true,
});

export interface GeofenceValues {
  readonly geofenceLat: number | null;
  readonly geofenceLng: number | null;
  readonly geofenceRadiusM: number;
}

/**
 * Strings, not numbers.
 *
 * A number field mid-edit holds "19.", "-" and "" — all of which `Number()`
 * turns into something confident and wrong. Keeping the text and parsing once,
 * at the point of saving, is what lets somebody type a minus sign without the
 * field jumping under them.
 */
export interface OfficeDraft {
  readonly locationId: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly radiusM: string;
}

export type OfficeChange =
  | { readonly kind: 'clean' }
  /** Nothing is sent, and the panel says why rather than earning a 400. */
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'dirty'; readonly values: GeofenceValues };

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** An empty field is not a bad number: it is "no centre", which is a real state. */
function readCoordinate(text: string, limit: number): Read<number | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, value: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return { ok: false };
  return { ok: true, value };
}

function readRadius(text: string): Read<number> {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < MIN_RADIUS_M || value > MAX_RADIUS_M) return { ok: false };
  return { ok: true, value };
}

/**
 * Six decimal places is all this panel can express, so two centres that print
 * the same are the same as far as it is concerned. Comparing the raw numbers
 * instead would report a location stored to eight places as edited the moment
 * the screen opened, and offer to save a change nobody made.
 */
function sameCoordinate(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return formatCoordinate(left) === formatCoordinate(right);
}

export function isGeofenced(location: LocationSummary): boolean {
  return location.geofenceLat !== null && location.geofenceLng !== null;
}

/**
 * Both coordinate fields empty, which is the draft saying "no geofence".
 *
 * Half a pair does not count: that is a centre being typed, and the radius
 * beside it still belongs to the reader.
 */
export function draftHasNoCentre(draft: OfficeDraft): boolean {
  return draft.latitude.trim() === '' && draft.longitude.trim() === '';
}

export function officeDraftOf(location: LocationSummary): OfficeDraft {
  return {
    locationId: location.id,
    latitude: location.geofenceLat === null ? '' : formatCoordinate(location.geofenceLat),
    longitude: location.geofenceLng === null ? '' : formatCoordinate(location.geofenceLng),
    // A stored radius on a location with no centre is the column's NOT NULL
    // default rather than a figure anybody chose — the radius does nothing
    // until there is a centre — so a first centre starts from the number that
    // actually works on a phone instead of inheriting that 100.
    radiusM: String(isGeofenced(location) ? location.geofenceRadiusM : DEFAULT_GEOFENCE_RADIUS_M),
  };
}

export function officeChangeOf(draft: OfficeDraft, saved: LocationSummary): OfficeChange {
  const latitude = readCoordinate(draft.latitude, MAX_LATITUDE);
  if (!latitude.ok) {
    return { kind: 'invalid', message: 'The latitude has to be a number between -90 and 90.' };
  }

  const longitude = readCoordinate(draft.longitude, MAX_LONGITUDE);
  if (!longitude.ok) {
    return { kind: 'invalid', message: 'The longitude has to be a number between -180 and 180.' };
  }

  // A centre is a pair. Half of one is not a weaker geofence, it is a geofence
  // the punch path cannot evaluate, and the server refuses it — so the screen
  // refuses it first, with the sentence that says how to fix it.
  if ((latitude.value === null) !== (longitude.value === null)) {
    return {
      kind: 'invalid',
      message:
        'A centre needs both a latitude and a longitude. Fill in the other one, or clear both to switch geofencing off.',
    };
  }

  const centred = latitude.value !== null;

  // No centre on either side means there is nothing to save whatever the
  // radius field shows, because a radius without a centre changes nothing.
  // This is also what keeps the screen from opening dirty on a location that
  // has never been geofenced.
  if (!centred && !isGeofenced(saved)) return { kind: 'clean' };

  const radius = centred ? readRadius(draft.radiusM) : { ok: true as const, value: saved.geofenceRadiusM };
  if (!radius.ok) {
    return {
      kind: 'invalid',
      message: `The radius has to be a whole number of metres between ${String(MIN_RADIUS_M)} and ${String(MAX_RADIUS_M)}.`,
    };
  }

  const values: GeofenceValues = {
    geofenceLat: latitude.value,
    geofenceLng: longitude.value,
    geofenceRadiusM: radius.value,
  };

  const unchanged =
    sameCoordinate(values.geofenceLat, saved.geofenceLat) &&
    sameCoordinate(values.geofenceLng, saved.geofenceLng) &&
    values.geofenceRadiusM === saved.geofenceRadiusM;

  return unchanged ? { kind: 'clean' } : { kind: 'dirty', values };
}
