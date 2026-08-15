import { create } from 'zustand';

/**
 * Whether the calculator is up, and which field it was opened from.
 *
 * REQ-N-03 asks for the result to be "copyable into the focused field", which
 * means the field has to be remembered before the panel opens: a modal moves
 * focus into itself, so by the time anything inside it renders,
 * `document.activeElement` is a key on the keypad. The element is captured in
 * the action that opens the panel, which is the last moment the answer is still
 * true.
 *
 * A DOM node in a store is unusual. The alternative -- a module-level ref --
 * would not re-render the footer that decides between "Copy" and "Put in
 * field", and two sources for one fact is how that button ends up lying. It is
 * cleared on close, so nothing outlives the panel.
 */
interface CalculatorState {
  open: boolean;
  target: HTMLInputElement | HTMLTextAreaElement | null;
  openPanel: () => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

function focusedField(): HTMLInputElement | HTMLTextAreaElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return active;
  if (!(active instanceof HTMLInputElement)) return null;
  // A checkbox has no text to receive a total, and a read-only field is not
  // offering to take one.
  const takesText = !['checkbox', 'radio', 'file', 'button', 'submit'].includes(active.type);
  return takesText && !active.readOnly && !active.disabled ? active : null;
}

export const useCalculatorStore = create<CalculatorState>((set, get) => ({
  open: false,
  target: null,
  openPanel: () => {
    set({ open: true, target: focusedField() });
  },
  setOpen: (open) => {
    set(open ? { open, target: focusedField() } : { open, target: null });
  },
  toggle: () => {
    if (get().open) set({ open: false, target: null });
    else set({ open: true, target: focusedField() });
  },
}));
