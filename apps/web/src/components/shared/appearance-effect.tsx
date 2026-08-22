import { useEffect } from 'react';

import { DEFAULT_APPEARANCE } from '@vyuha/shared';

import { useBranding } from '@/lib/branding/use-branding';

import { applyAppearance } from './appearance';

/** Mounted once in the shell; follows the branding query, which every signed-in client already polls. */
export function AppearanceEffect() {
  const branding = useBranding();
  const appearance = branding.data?.appearance;
  useEffect(() => {
    applyAppearance(document.documentElement, appearance ?? DEFAULT_APPEARANCE);
  }, [appearance]);
  return null;
}
