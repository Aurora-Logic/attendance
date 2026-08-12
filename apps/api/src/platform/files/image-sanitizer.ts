import { ERROR_CODES } from '@vyuha/shared';
import sharp, { type Sharp } from 'sharp';

import { AppError, describeError } from '../common/errors.js';
import { isAcceptedUpload, sniffType, type SniffedType } from './magic-bytes.js';

/**
 * Decode, then re-encode. **The re-encode is the sanitisation** -- bytes a
 * client supplied are never stored, and there is no code path here that
 * returns the input buffer.
 *
 * What that buys, in order of how much it matters:
 *
 * - **EXIF is gone.** Not filtered, not blanked: the output is written from
 *   decoded pixels and sharp copies no metadata unless asked. A phone photo
 *   arrives carrying GPS coordinates, a device serial, and a capture time, and
 *   REQ-M-03 promises employees that what is retained is the photo. Orientation
 *   is the one tag that must survive, and it survives as *rotated pixels*
 *   rather than as a tag (`.rotate()` with no argument).
 * - **A polyglot stops being one.** A file that is a valid JPEG and also a
 *   valid ZIP loses everything after the image data, because the appended
 *   bytes are not pixels and are not part of what gets written back out.
 * - **A malformed image fails here**, in a decoder, rather than in whatever
 *   opens it later.
 *
 * The magic-byte sniff (`magic-bytes.ts`) runs first and decides whether a
 * decode is attempted at all. Passing an executable to a decoder and relying
 * on it to object is a worse position than not passing it at all.
 */

/**
 * A guard against a decompression bomb: a few kilobytes of PNG can declare
 * 40,000 x 40,000 pixels, which is 6.4 GB once decoded. 50 megapixels is far
 * beyond any phone camera and far below anything that hurts.
 */
const MAX_INPUT_PIXELS = 50_000_000;

export interface SanitizeOptions {
  /** Longest edge of the output. Smaller inputs are never enlarged. */
  readonly maxEdge: number;
  /** JPEG quality, and the top of the ladder when `maxBytes` is set. */
  readonly quality: number;
  readonly format: 'jpeg' | 'png';
  /**
   * Re-encode at falling quality until the result fits in this many bytes.
   *
   * A caller with a storage budget rather than a quality preference (REQ-D-03a
   * puts punch photos in an 80-150 KB band) needs the output size to be the
   * constraint, and only the encoder can see that. Nothing is inflated to
   * reach a lower bound: an image that is already small at full quality is
   * left alone rather than degraded to make a number come out.
   */
  readonly maxBytes?: number;
}

export interface SanitizedImage {
  readonly bytes: Buffer;
  readonly mime: string;
  readonly extension: string;
  readonly width: number;
  readonly height: number;
  /** What the input actually was, as opposed to what it was labelled. */
  readonly sourceType: SniffedType;
}

function invalidPhoto(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(ERROR_CODES.PUNCH_PHOTO_INVALID, message, details ? { details } : {});
}

/**
 * Throws `PUNCH_PHOTO_INVALID` for anything that is not a decodable JPEG or
 * PNG. Never returns the input buffer.
 */
export async function sanitizeImage(
  input: Buffer,
  options: SanitizeOptions,
): Promise<SanitizedImage> {
  const sniffed = sniffType(input);

  if (!isAcceptedUpload(sniffed)) {
    throw invalidPhoto(
      sniffed === null
        ? 'That file is not an image. Only JPEG and PNG are accepted.'
        : `That file is a ${sniffed.label}. Only JPEG and PNG are accepted.`,
      { detectedMime: sniffed?.mime ?? null },
    );
  }

  const pipeline = sharp(input, {
    // Refuses a truncated or structurally broken file instead of recovering
    // it into something that looks fine and is not what was captured.
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: false,
  });

  const metadata = await pipeline.metadata().catch((error: unknown) => {
    throw invalidPhoto('That image could not be read.', { reason: describeError(error) });
  });

  // The sniff read three bytes; the decoder read the whole container. If they
  // disagree, the leading bytes were a costume and the sniff is the thing that
  // was fooled.
  const decodedMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${String(metadata.format)}`;
  if (sniffed !== null && decodedMime !== sniffed.mime) {
    throw invalidPhoto('That file does not match the image format it claims to be.', {
      detectedMime: sniffed.mime,
      decodedFormat: metadata.format ?? null,
    });
  }

  const resized = pipeline
    // No argument: apply the EXIF orientation to the pixels, then drop the tag.
    .rotate()
    .resize({
      width: options.maxEdge,
      height: options.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });

  try {
    const { data, info } =
      options.format === 'png'
        ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await encodeJpegWithinBudget(resized, options);

    return {
      bytes: data,
      mime: options.format === 'png' ? 'image/png' : 'image/jpeg',
      extension: options.format === 'png' ? 'png' : 'jpg',
      width: info.width,
      height: info.height,
      // Non-null is safe: `isAcceptedUpload` above returned true, which cannot
      // happen for null.
      sourceType: sniffed ?? { mime: decodedMime, extension: 'jpg', label: 'image' },
    };
  } catch (error: unknown) {
    throw invalidPhoto('That image could not be processed.', { reason: describeError(error) });
  }
}

/**
 * The quality ladder REQ-D-03a asks for, expressed as fixed steps rather than a
 * binary search.
 *
 * Fixed steps because the result has to be reproducible: a search over a
 * continuous range lands on a slightly different quality for two nearly
 * identical photographs, and "why is yesterday's punch photo sharper than
 * today's" is not a question worth being unable to answer. Eight steps is at
 * most eight encodes of a 1280px image, and in practice the first or second
 * lands inside the band.
 */
const JPEG_QUALITY_LADDER: readonly number[] = [76, 68, 60, 52, 44, 36, 28];

interface EncodedImage {
  readonly data: Buffer;
  readonly info: { readonly width: number; readonly height: number };
}

async function encodeJpegWithinBudget(
  pipeline: Sharp,
  options: SanitizeOptions,
): Promise<EncodedImage> {
  const encode = async (quality: number): Promise<EncodedImage> => {
    // `clone()` per attempt: a sharp pipeline is single-use, and reusing one
    // would apply the second encoder's settings on top of the first.
    const { data, info } = await pipeline
      .clone()
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, info };
  };

  let best = await encode(options.quality);
  const budget = options.maxBytes;
  if (budget === undefined) return best;

  for (const quality of JPEG_QUALITY_LADDER) {
    if (best.data.length <= budget) return best;
    if (quality >= options.quality) continue;
    best = await encode(quality);
  }

  // Still over budget at the bottom of the ladder. The bytes are returned
  // rather than refused: a punch photo that is 10 KB too large is not a reason
  // to stop somebody clocking in, and the caller records the real size.
  return best;
}
