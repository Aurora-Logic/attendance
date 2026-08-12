import { useSyncExternalStore } from 'react';

/**
 * Whether the browser thinks it can reach the network (REQ-D-10).
 *
 * `navigator.onLine` is a weak signal - it reports a captive portal as online
 * - so the screen never uses it to claim a punch succeeded. It is used only to
 * decide what to offer: queue it, or send it. The authority on whether a punch
 * was recorded is always the server's answer.
 *
 * `useSyncExternalStore` rather than state plus an effect. The connection can
 * drop between the first render and the subscription being attached, and the
 * effect version of this hook has to paper over that with an extra setState
 * that React now warns about. This reads the live value on every render and
 * cannot miss the event.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server snapshot. There is no server rendering here, but the argument is
    // required and "online" is the only answer that does not make a static
    // render claim the connection is down.
    () => true,
  );
}
