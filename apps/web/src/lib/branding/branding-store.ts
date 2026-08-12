import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Organisation branding (REQ-L-01: "Org profile, logo").
 *
 * Persisted to localStorage for now. The permanent home is
 * `organizations.logo_key` pointing at a row in `files`, written through the
 * settings endpoint — none of which exists yet. This is a real persistence
 * layer rather than a placeholder, so the control works today, but it is
 * per-browser: a second person signing in will not see the logo until the
 * server owns it. Recorded as P0-7.
 *
 * The image is normalised to a 128px PNG data URL before it gets here, which
 * keeps it well inside the localStorage quota and mirrors the server-side
 * re-encode rule the photo pipeline already commits to.
 */
interface BrandingState {
  logoDataUrl: string | null;
  setLogo: (dataUrl: string) => void;
  clearLogo: () => void;
}

export const useBrandingStore = create<BrandingState>()(
  persist(
    (set) => ({
      logoDataUrl: null,
      setLogo: (dataUrl) => {
        set({ logoDataUrl: dataUrl });
      },
      clearLogo: () => {
        set({ logoDataUrl: null });
      },
    }),
    { name: 'vyuha.branding' },
  ),
);

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Rendered at 32px; 128 keeps it crisp on a 3x display without bloating storage. */
export const LOGO_RENDER_PX = 128;

export interface LogoRejection {
  reason: string;
}

/**
 * Decodes, validates and re-encodes a chosen file to a square PNG data URL.
 *
 * SVG is deliberately not accepted. It is markup rather than an image, it can
 * carry script and external references, and nothing here needs vector.
 *
 * The file is decoded before it is trusted: a rename cannot make a text file
 * into a PNG, because `createImageBitmap` refuses to decode it. That is the
 * client-side half of the same magic-byte rule the punch photo pipeline
 * applies on the server.
 */
export async function prepareLogo(file: File): Promise<string | LogoRejection> {
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

    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024).toString()} KB`;
}
