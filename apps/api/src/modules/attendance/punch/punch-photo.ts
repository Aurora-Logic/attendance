import { ERROR_CODES, type PunchType } from '@vyuha/shared';
import sharp from 'sharp';

import { AppError, describeError } from '../../../platform/common/errors.js';

/**
 * REQ-D-03: "The **server** (not the client) burns a stamp onto the stored
 * image: date, time, employee name, employee code, punch type."
 *
 * Technical design §7 says why in one line: "The stamp is applied server-side
 * because a client-side stamp is trivially forged." Everything in this file is
 * downstream of that sentence -- the facts come from the employee row and the
 * server clock, never from the request body, and there is no parameter a caller
 * could set to change what is drawn.
 *
 * This lives in the attendance module rather than in `platform/files` because
 * the *content* of the stamp is an attendance concept. The platform owns
 * decoding, EXIF stripping and re-encoding; it has no business knowing what an
 * employee code is.
 */

export interface StampFacts {
  readonly employeeName: string;
  readonly employeeCode: string;
  readonly punchType: PunchType;
  /** Authoritative server time (REQ-D-05), rendered in the location's zone. */
  readonly serverTime: Date;
  readonly timezone: string;
}

/**
 * Proportional to the image so the stamp is the same relative size on a 640px
 * upload and a 1280px one, with a floor for the small end. REQ-D-03a makes
 * legibility after compression a test assertion, and text under about eleven
 * pixels does not survive a JPEG quality ladder.
 */
const BAND_FRACTION = 0.155;
const MIN_BAND_HEIGHT = 44;
const FONT_FRACTION = 0.03;
const MIN_FONT_SIZE = 11;

/**
 * A dark band behind white text, rather than text drawn straight onto the
 * photo. Contrast cannot be assumed when the background is whatever the camera
 * saw -- white text on a whitewashed wall is an invisible stamp, which is the
 * same as no stamp at all.
 */
const BAND_FILL = 'rgba(0,0,0,0.66)';
const TEXT_FILL = '#ffffff';
const RULE_FILL = 'rgba(255,255,255,0.55)';

/**
 * The font stack, widest net first. `sans-serif` alone resolves to nothing on
 * a container image with no fonts installed, and the failure is silent: the
 * SVG renders, the band appears, and the text simply is not there. The punch
 * suite therefore measures ink in the stamp region rather than trusting that
 * this worked.
 */
const FONT_STACK = 'DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif';

/** XML, so five characters decide whether an employee named "A & B" renders. */
function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

/**
 * Bounded so a long name cannot push the punch type and time off the edge of
 * the image, which would remove exactly the parts a dispute turns on.
 */
function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}...`;
}

function formatStampTime(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(instant);

  // en-GB renders "12 Aug 2026, 17:42:03 GMT+5:30"; the comma adds nothing on
  // a single line of overlay text.
  return parts.replace(', ', ' ');
}

export function stampLines(facts: StampFacts): readonly [string, string] {
  return [
    `${truncate(facts.employeeName, 34)} (${truncate(facts.employeeCode, 16)})`,
    `${facts.punchType}  ${formatStampTime(facts.serverTime, facts.timezone)}`,
  ];
}

function buildBandSvg(width: number, bandHeight: number, lines: readonly [string, string]): Buffer {
  const fontSize = Math.max(MIN_FONT_SIZE, Math.round(width * FONT_FRACTION));
  const padding = Math.round(fontSize * 0.6);
  const firstBaseline = Math.round(bandHeight / 2) - Math.round(fontSize * 0.15);
  const secondBaseline = firstBaseline + Math.round(fontSize * 1.25);

  const svg = `<svg width="${String(width)}" height="${String(bandHeight)}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${String(width)}" height="${String(bandHeight)}" fill="${BAND_FILL}"/>
  <rect x="0" y="0" width="${String(width)}" height="1" fill="${RULE_FILL}"/>
  <text x="${String(padding)}" y="${String(firstBaseline)}" font-family="${FONT_STACK}" font-size="${String(fontSize)}" font-weight="bold" fill="${TEXT_FILL}">${escapeXml(lines[0])}</text>
  <text x="${String(padding)}" y="${String(secondBaseline)}" font-family="${FONT_STACK}" font-size="${String(fontSize)}" fill="${TEXT_FILL}">${escapeXml(lines[1])}</text>
</svg>`;

  return Buffer.from(svg, 'utf8');
}

/**
 * Returns a new JPEG with the stamp burned into its pixels.
 *
 * Burned, not attached: there is no metadata field here and nothing a viewer
 * could switch off. Re-encoding at a high quality because the caller compresses
 * afterwards to the REQ-D-03a band, and compressing twice from a low starting
 * quality is what turns a stamp into mush.
 */
export async function burnStamp(bytes: Buffer, facts: StampFacts): Promise<Buffer> {
  try {
    const image = sharp(bytes, { failOn: 'error' });
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;

    if (width === undefined || height === undefined || width < 1 || height < 1) {
      throw new Error('The sanitised image reported no dimensions.');
    }

    const bandHeight = Math.max(MIN_BAND_HEIGHT, Math.round(height * BAND_FRACTION));
    const band = buildBandSvg(width, Math.min(bandHeight, height), stampLines(facts));

    return await image
      .composite([{ input: band, gravity: 'south' }])
      .jpeg({ quality: 94, progressive: true })
      .toBuffer();
  } catch (error: unknown) {
    // Not swallowed and not degraded to an unstamped photo: an unstamped punch
    // photo is missing the anti-fraud control REQ-D-03 exists to provide, so
    // the punch fails rather than being recorded without its evidence.
    throw new AppError(
      ERROR_CODES.PUNCH_PHOTO_INVALID,
      'That photo could not be stamped, so the punch was not recorded.',
      { details: { reason: describeError(error) }, cause: error },
    );
  }
}
