/**
 * Geofencing helpers.
 *
 * A branch geofence is a centre plus a radius. Rather than asking an admin to
 * find raw coordinates, we accept a Google Maps link and pull the coordinates
 * out of it — every Maps URL carries them in one of a few known shapes.
 */

export interface LatLng {
  lat: number
  lng: number
}

export interface ParsedMapsLink {
  ok: boolean
  coords?: LatLng
  /** Which pattern matched — shown back to the admin so the parse is auditable. */
  matched?: string
  error?: string
}

const PATTERNS: Array<{ name: string; re: RegExp; latIndex: number; lngIndex: number }> = [
  // https://www.google.com/maps/@19.0760,72.8777,17z
  { name: "map centre (@lat,lng,zoom)", re: /@(-?\d+\.\d+),(-?\d+\.\d+)/, latIndex: 1, lngIndex: 2 },
  // https://www.google.com/maps/place/Foo/@19.07,72.87 ... /data=!3d19.0760!4d72.8777
  { name: "place pin (!3d/!4d)", re: /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, latIndex: 1, lngIndex: 2 },
  // https://maps.google.com/?q=19.0760,72.8777
  { name: "query (?q=)", re: /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, latIndex: 1, lngIndex: 2 },
  // https://maps.google.com/?ll=19.0760,72.8777
  { name: "query (?ll=)", re: /[?&]ll=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, latIndex: 1, lngIndex: 2 },
  // https://www.google.com/maps/search/?api=1&query=19.0760,72.8777
  { name: "search API (query=)", re: /[?&]query=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, latIndex: 1, lngIndex: 2 },
  // Bare "19.0760, 72.8777" pasted straight from the Maps info panel
  { name: "bare coordinates", re: /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/, latIndex: 1, lngIndex: 2 },
]

/**
 * Extract coordinates from a Google Maps link.
 *
 * Note the one case this cannot handle: shortened `maps.app.goo.gl` / `goo.gl/maps`
 * links carry no coordinates at all — they are opaque redirects. Those must be
 * resolved server-side by following the redirect, which is why the branch form
 * asks for the full link.
 */
export function parseGoogleMapsLink(input: string): ParsedMapsLink {
  const value = input.trim()
  if (!value) return { ok: false, error: "Paste a Google Maps link or coordinates." }

  if (/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(value)) {
    return {
      ok: false,
      error:
        "Short links carry no coordinates. Open it in Maps and copy the full URL from the address bar.",
    }
  }

  for (const pattern of PATTERNS) {
    const match = value.match(pattern.re)
    if (!match) continue
    const lat = Number(match[pattern.latIndex])
    const lng = Number(match[pattern.lngIndex])
    if (!isValidLatLng({ lat, lng })) continue
    return { ok: true, coords: { lat, lng }, matched: pattern.name }
  }

  return {
    ok: false,
    error: "No coordinates found. Expected a link containing @lat,lng or ?q=lat,lng.",
  }
}

export function isValidLatLng({ lat, lng }: LatLng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Haversine distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)))
}

export interface GeofenceVerdict {
  inside: boolean
  distanceM: number
  /** GPS accuracy can straddle the boundary — that is not the same as being outside. */
  uncertain: boolean
  explanation: string
}

/**
 * Evaluate a punch position against a branch geofence.
 *
 * Accuracy matters: a phone reporting ±80 m at 220 m from a 200 m fence is not
 * reliably outside it. Those punches are marked uncertain so they route to
 * approval with the doubt recorded, rather than being asserted as violations.
 */
export function checkGeofence(
  punchAt: LatLng,
  branchAt: LatLng,
  radiusM: number,
  accuracyM = 0
): GeofenceVerdict {
  const distanceM = distanceMetres(punchAt, branchAt)
  const inside = distanceM <= radiusM
  const uncertain = !inside && distanceM - accuracyM <= radiusM

  return {
    inside,
    distanceM,
    uncertain,
    explanation: inside
      ? `${distanceM} m from the branch, inside the ${radiusM} m fence.`
      : uncertain
        ? `${distanceM} m from the branch with ±${accuracyM} m GPS accuracy — cannot be sure it is outside the ${radiusM} m fence.`
        : `${distanceM} m from the branch, outside the ${radiusM} m fence.`,
  }
}

/** Link back to the pinned location so an approver can eyeball it. */
export function mapsLinkFor({ lat, lng }: LatLng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
