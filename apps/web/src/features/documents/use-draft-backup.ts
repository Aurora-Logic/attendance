import { useEffect, useRef, useState } from 'react';

/**
 * A dropped connection or an accidental swipe-back must not lose a document
 * being typed (the brief's draft autosave). The unsaved draft of a *new*
 * document is mirrored into sessionStorage a moment after each change;
 * saving or leaving through the app clears it, and reopening the creation
 * screen in the same tab offers the copy back exactly once. Session rather
 * than local storage on purpose: this is crash insurance, not a drafts
 * feature — the server's draft is the real one the moment Save works.
 */
export function useDraftBackup<T>(key: string, draft: T, enabled: boolean): { restored: T | null; clear: () => void } {
  const storageKey = `vyuha.draft-backup.${key}`;
  const [restored] = useState<T | null>(() => {
    if (!enabled) return null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        // Quota or privacy mode: the backup silently does not exist.
      }
    }, 400);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [draft, enabled, storageKey]);

  return {
    restored,
    clear: () => {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // Nothing to clear where nothing could be stored.
      }
    },
  };
}
