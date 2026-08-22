import { useCallback, useEffect, useState } from 'react';

/**
 * The device's position, for the geofence check (REQ-D-08).
 *
 * The client only reports; the server decides. That matters because a
 * client-side geofence is trivially defeated, so nothing here blocks a punch -
 * it collects the reading and its accuracy and lets the API reject or flag it.
 *
 * A denied or unavailable fix is reported as a state the form reacts to -
 * the punch button waits for a position, with a retry beside the message -
 * rather than as an error that takes the screen down. The server refuses a
 * punch with no position (owner, 21 Aug 2026), so the form never sends one.
 */

export type LocationState = 'locating' | 'ready' | 'denied' | 'unavailable' | 'timed-out';

export interface Coords {
  latitude: number;
  longitude: number;
  /** REQ-D-08: the geofence check subtracts this before rejecting anybody. */
  accuracyM: number;
}

export interface Geolocation {
  state: LocationState;
  coords: Coords | null;
  retry: () => void;
}

/** Indoor GPS regularly degrades past this; worth telling the reader. */
export const POOR_ACCURACY_M = 50;

export function useGeolocation(): Geolocation {
  // Decided at first render rather than inside the effect. A browser with no
  // geolocation API cannot acquire one later, so starting in 'locating' and
  // immediately correcting it is a cascading render for a fact that was
  // already known.
  const supported = 'geolocation' in navigator;
  const [state, setState] = useState<LocationState>(supported ? 'locating' : 'unavailable');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
        setState('ready');
      },
      (error) => {
        if (cancelled) return;
        // PERMISSION_DENIED is the one that matters: REQ-D-08a calls repeated
        // denials the obvious way to route around a geofence, so it is
        // reported distinctly rather than folded into "unavailable".
        if (error.code === error.PERMISSION_DENIED) setState('denied');
        else if (error.code === error.TIMEOUT) setState('timed-out');
        else setState('unavailable');
      },
      {
        // Worth the battery: a coarse fix inside a building is what causes the
        // false rejections REQ-D-08 spends a paragraph guarding against.
        enableHighAccuracy: true,
        timeout: 15_000,
        // A fix from a minute ago is fine for a punch and saves a cold start.
        maximumAge: 60_000,
      },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt, supported]);

  const retry = useCallback(() => {
    setState('locating');
    setAttempt((current) => current + 1);
  }, []);

  return { state, coords, retry };
}
