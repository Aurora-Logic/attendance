// Moved to @attendance/shared so the API enforces the same geofence maths
// the punch screen previews. Re-exported here to keep import paths stable.
export {
  parseGoogleMapsLink,
  isValidLatLng,
  distanceMetres,
  checkGeofence,
  mapsLinkFor,
} from "@attendance/shared"
export type { LatLng, ParsedMapsLink, GeofenceVerdict } from "@attendance/shared"
