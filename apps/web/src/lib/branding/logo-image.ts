/**
 * Turning a chosen file into something worth sending (REQ-L-01).
 *
 * This is a courtesy, not a control. Every rule below is enforced again on the
 * server, which sniffs the type by magic bytes and re-encodes through sharp, so
 * nothing a client supplied is ever stored. What this buys is that the person
 * choosing the file learns it is wrong in the file picker rather than from a
 * 422, and that a 4 MB photograph becomes a 128px PNG before it crosses a
 * mobile connection.
 *
 * SVG is deliberately not accepted. It is markup rather than an image, it can
 * carry script and external references, and nothing here needs vector.
 */

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Rendered at 32px; 128 keeps it crisp on a 3x display without bloating the upload. */
export const LOGO_RENDER_PX = 128;

export interface PreparedLogo {
  /** What gets uploaded. Always a PNG, whatever went in. */
  readonly blob: Blob;
  /** The same image as a data URL, for the preview before anything is sent. */
  readonly previewUrl: string;
}

export interface LogoRejection {
  readonly reason: string;
}

export function isRejection(value: PreparedLogo | LogoRejection): value is LogoRejection {
  return 'reason' in value;
}

/**
 * Decodes, validates and re-encodes a chosen file to a square PNG.
 *
 * The file is decoded before it is trusted: a rename cannot make a text file
 * into a PNG, because `createImageBitmap` refuses to decode it. WebP is
 * accepted here and not by the server, which is not an oversight -- the canvas
 * re-encode makes every output a PNG, so a WebP input arrives as one.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo | LogoRejection> {
  if (!LOGO_ACCEPTED_TYPES.includes(file.type as (typeof LOGO_ACCEPTED_TYPES)[number])) {
    return { reason: 'Choose a PNG, JPEG or WebP image.' };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { reason: `That file is ${formatBytes(file.size)}. The limit is 2 MB.` };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { reason: 'That file could not be read as an image.' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_RENDER_PX;
    canvas.height = LOGO_RENDER_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { reason: 'This browser could not process the image.' };

    // Contain rather than crop: a wordmark that is wider than it is tall must
    // not lose its ends to a square frame.
    const scale = Math.min(LOGO_RENDER_PX / bitmap.width, LOGO_RENDER_PX / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.drawImage(
      bitmap,
      (LOGO_RENDER_PX - width) / 2,
      (LOGO_RENDER_PX - height) / 2,
      width,
      height,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (blob === null) return { reason: 'This browser could not encode the image.' };

    return { blob, previewUrl: canvas.toDataURL('image/png') };
  } finally {
    bitmap.close();
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024).toString()} KB`;
}
