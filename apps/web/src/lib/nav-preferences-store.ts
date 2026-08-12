import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which routes the phone's bottom bar shows.
 *
 * A UI preference, so localStorage is the right home for it — it belongs to
 * this person on this device, and losing it costs nothing. It is deliberately
 * not a server-side setting: the whole point is that a punch-only shop-floor
 * user and an HR manager on the same account type want different bars.
 *
 * `null` means "never chosen", which is different from "chose an empty bar" —
 * the first resolves to sensible defaults, the second is a state a person
 * asked for. Storing routes rather than indexes means a nav reorder does not
 * silently rearrange somebody's bar.
 */
interface NavPreferencesState {
  bottomNavRoutes: string[] | null;
  setBottomNavRoutes: (routes: string[]) => void;
  resetBottomNav: () => void;
}

/** Four plus More is what fits at 360px without the labels truncating. */
export const BOTTOM_NAV_SLOTS = 4;

export const useNavPreferencesStore = create<NavPreferencesState>()(
  persist(
    (set) => ({
      bottomNavRoutes: null,
      setBottomNavRoutes: (routes) => {
        set({ bottomNavRoutes: routes.slice(0, BOTTOM_NAV_SLOTS) });
      },
      resetBottomNav: () => {
        set({ bottomNavRoutes: null });
      },
    }),
    { name: 'vyuha.nav-preferences' },
  ),
);
