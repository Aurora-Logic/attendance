import { create } from 'zustand';

/**
 * Shell overlay state. The Go To palette and the shortcut sheet are each
 * reachable two ways — a keyboard shortcut and a header button — and both
 * paths have to drive the same state. Keeping it here means the button does
 * not have to fake a keypress to open the thing the shortcut opens.
 *
 * Zustand is used sparingly and only for UI shell state, per the stack rules
 * in technical design §2.
 */
interface UiState {
  gotoOpen: boolean;
  shortcutsOpen: boolean;
  setGotoOpen: (open: boolean) => void;
  toggleGoto: () => void;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  gotoOpen: false,
  shortcutsOpen: false,
  setGotoOpen: (open) => {
    set({ gotoOpen: open });
  },
  toggleGoto: () => {
    set((s) => ({ gotoOpen: !s.gotoOpen }));
  },
  setShortcutsOpen: (open) => {
    set({ shortcutsOpen: open });
  },
  toggleShortcuts: () => {
    set((s) => ({ shortcutsOpen: !s.shortcutsOpen }));
  },
}));
