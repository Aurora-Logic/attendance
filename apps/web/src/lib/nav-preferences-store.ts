import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which routes the phone's bottom bar shows — per module, because the bar
 * follows the active module: a warehouse thumb wants Pick queue and GRNs in
 * Purchase, and Punch in Attendance, and neither choice should overwrite
 * the other.
 *
 * A UI preference, so localStorage is the right home for it — it belongs to
 * this person on this device, and losing it costs nothing. An absent entry
 * means "never chosen", which resolves to the module's own first
 * destinations; an empty array is a state a person asked for.
 */
interface NavPreferencesState {
  bottomNavByModule: Record<string, string[]>;
  setBottomNavRoutes: (moduleId: string, routes: string[]) => void;
  resetBottomNav: (moduleId: string) => void;
}

/** Four plus More is what fits at 360px without the labels truncating. */
export const BOTTOM_NAV_SLOTS = 4;

export const useNavPreferencesStore = create<NavPreferencesState>()(
  persist(
    (set) => ({
      bottomNavByModule: {},
      setBottomNavRoutes: (moduleId, routes) => {
        set((state) => ({ bottomNavByModule: { ...state.bottomNavByModule, [moduleId]: routes.slice(0, BOTTOM_NAV_SLOTS) } }));
      },
      resetBottomNav: (moduleId) => {
        set((state) => {
          const { [moduleId]: _dropped, ...rest } = state.bottomNavByModule;
          return { bottomNavByModule: rest };
        });
      },
    }),
    {
      name: 'vyuha.nav-preferences',
      version: 2,
      // v1 stored one flat array for the whole app; it was chosen while the
      // bar was attendance-only, so that is the module it belonged to.
      migrate: (persisted: unknown, version) => {
        if (version < 2 && typeof persisted === 'object' && persisted !== null) {
          const old = (persisted as { bottomNavRoutes?: string[] | null }).bottomNavRoutes;
          return { bottomNavByModule: Array.isArray(old) ? { attendance: old } : {} };
        }
        return persisted as NavPreferencesState;
      },
    },
  ),
);
