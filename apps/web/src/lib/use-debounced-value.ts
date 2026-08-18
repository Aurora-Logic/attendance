import { useEffect, useState } from 'react';

/**
 * The debounced copy of a changing value. One implementation for the palette
 * and every register search, because three hand-rolled setTimeout dances is
 * how one screen gets a flush fix and the others keep the bug.
 */
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === debounced) return undefined;
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, debounced, delayMs]);
  return debounced;
}
