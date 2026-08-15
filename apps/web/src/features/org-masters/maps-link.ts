/**
 * Coordinates out of whatever somebody pastes.
 *
 * Nobody types a latitude. They open Google Maps, find the office, press
 * Share, and paste. Asking an administrator to extract two decimal numbers
 * from that themselves is asking them to make a mistake that nobody notices
 * until an employee standing in the office is refused a punch.
 *
 * Every form Google actually produces is handled, and the one it produces most
 * often — the short link from the Share button — is the one that cannot be:
 * `maps.app.goo.gl/xyz` carries no coordinates at all, only an id the server
 * resolves. Following it would need a cross-origin request the browser
 * refuses. So it is detected by name and answered with what to do instead,
 * rather than reported as "not a valid link", which would send somebody
 * looking for a typo in a URL that is perfectly correct.
 */

export type MapsLinkResult =
  | { kind: 'found'; latitude: number; longitude: number }
  | { kind: 'short-link'; message: string }
  | { kind: 'unrecognised'; message: string }
  | { kind: 'empty' };

/** Latitude and longitude, in that order, as Google writes them. */
const PAIR = String.raw`(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)`;

const PATTERNS: readonly RegExp[] = [
  // .../@19.0759837,72.8776559,17z — the map's own centre, in every /maps/ URL.
  new RegExp(String.raw`@${PAIR}`, 'u'),
  // ?q=19.07,72.87 and ?ll=, ?daddr=, ?sll= — the query forms.
  new RegExp(String.raw`[?&](?:q|ll|sll|daddr|center)=${PAIR}`, 'u'),
  // !3d19.0759837!4d72.8776559 — the place's own pin inside the data blob,
  // which is more precise than @ when both are present, hence the order below.
  new RegExp(String.raw`!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)`, 'u'),
  // A bare "19.0759837, 72.8776559", which is what the right-click menu copies.
  new RegExp(String.raw`^\s*${PAIR}\s*$`, 'u'),
];

const SHORT_LINK = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/iu;

function isValidPair(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    // 0,0 is in the Atlantic. It is what a half-parsed URL produces, and
    // accepting it would put the office geofence in the Gulf of Guinea.
    !(latitude === 0 && longitude === 0)
  );
}

export function parseMapsLink(input: string): MapsLinkResult {
  const text = input.trim();
  if (text.length === 0) return { kind: 'empty' };

  if (SHORT_LINK.test(text)) {
    return {
      kind: 'short-link',
      message:
        'That is a shortened Google link, which hides the coordinates. Open it, then copy the full address bar — or right-click the spot in Google Maps and copy the numbers it offers.',
    };
  }

  // The place pin (!3d!4d) beats the map centre (@) when a URL carries both:
  // the centre is wherever the map happened to be scrolled to.
  const ordered = [PATTERNS[2], PATTERNS[0], PATTERNS[1], PATTERNS[3]];
  for (const pattern of ordered) {
    if (pattern === undefined) continue;
    const match = pattern.exec(text);
    if (match === null) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!isValidPair(latitude, longitude)) continue;
    return { kind: 'found', latitude, longitude };
  }

  return {
    kind: 'unrecognised',
    message:
      'No coordinates in that. Paste the full Google Maps address bar, or the two numbers from right-clicking the spot on the map.',
  };
}

/**
 * Six decimal places, which is about 11cm — far past what a phone can resolve,
 * and short enough to read back. More digits would imply a precision the
 * source does not have.
 */
export function formatCoordinate(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}
