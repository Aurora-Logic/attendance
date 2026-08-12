/**
 * Key combination parsing and matching.
 *
 * Matching is done on `KeyboardEvent.code`, not `.key`. On macOS, holding Alt
 * rewrites `.key` to the character the option key produces — Alt+G arrives as
 * "©" — so a registry built on `.key` silently stops working for every Alt
 * shortcut, which is most of the TallyPrime set (PRD §6.4). `.code` is the
 * physical key and is stable across layouts and modifiers.
 */

export interface KeyCombo {
  /** A KeyboardEvent.code value, e.g. "KeyG", "F12", "Escape". */
  code: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

const NAMED_CODES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};

function tokenToCode(token: string): string {
  const t = token.toLowerCase();
  if (NAMED_CODES[t]) return NAMED_CODES[t];
  if (/^f([1-9]|1[0-2])$/.test(t)) return t.toUpperCase();
  if (/^[a-z]$/.test(t)) return `Key${t.toUpperCase()}`;
  if (/^[0-9]$/.test(t)) return `Digit${t}`;
  throw new Error(`Unrecognised key token "${token}" in a shortcut specification`);
}

/** Parses "ctrl+shift+f1" into a comparable combo. Throws on nonsense. */
export function parseCombo(spec: string): KeyCombo {
  const tokens = spec
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) throw new Error(`Empty shortcut specification: "${spec}"`);

  const combo: KeyCombo = { code: '', alt: false, ctrl: false, shift: false, meta: false };

  for (const token of tokens) {
    switch (token) {
      case 'alt':
      case 'option':
        combo.alt = true;
        break;
      case 'ctrl':
      case 'control':
        combo.ctrl = true;
        break;
      case 'shift':
        combo.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        combo.meta = true;
        break;
      default:
        if (combo.code) {
          throw new Error(`Shortcut "${spec}" names more than one non-modifier key`);
        }
        combo.code = tokenToCode(token);
    }
  }

  if (!combo.code) throw new Error(`Shortcut "${spec}" has modifiers but no key`);
  return combo;
}

export function comboMatchesEvent(combo: KeyCombo, event: KeyboardEvent): boolean {
  return (
    event.code === combo.code &&
    event.altKey === combo.alt &&
    event.ctrlKey === combo.ctrl &&
    event.shiftKey === combo.shift &&
    event.metaKey === combo.meta
  );
}

const CODE_LABELS: Record<string, string> = {
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/**
 * Human-readable parts for the hint chip, e.g. ["Alt", "G"].
 * PRD §6.4 requires the key to be visible on the control, so this is part of
 * the contract rather than a convenience.
 */
export function formatCombo(combo: KeyCombo): string[] {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Cmd');

  const { code } = combo;
  if (CODE_LABELS[code]) parts.push(CODE_LABELS[code]);
  else if (code.startsWith('Key')) parts.push(code.slice(3));
  else if (code.startsWith('Digit')) parts.push(code.slice(5));
  else parts.push(code);

  return parts;
}

export function formatSpec(spec: string): string[] {
  return formatCombo(parseCombo(spec));
}
