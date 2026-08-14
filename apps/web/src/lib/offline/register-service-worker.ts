/**
 * Registers the service worker, and keeps checking for a newer one.
 *
 * Its own entry point (see `index.html`) rather than an import from `main.tsx`,
 * so registration is not tangled into the React tree. The production build
 * merges the two entries into one chunk, and that is fine: this code matters
 * only for the *first* registration. Afterwards the browser re-fetches
 * `/sw.js` itself on every navigation in scope, so a new deploy reaches a
 * browser holding the old worker whether or not the application bundle runs.
 *
 * There is deliberately no forced reload when a new worker takes control. The
 * worker calls `skipWaiting()` and `clients.claim()`, so the new build is
 * serving the moment it activates, and the next navigation or reload picks it
 * up. Reloading the page out from under somebody standing at a gate with a
 * camera open would be a worse bug than the one it solves.
 */

/** Hourly. Browsers also check on navigation; this covers a tab left open all day. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

function scheduleUpdates(registration: ServiceWorkerRegistration): void {
  const check = (): void => {
    // A check while offline rejects, and that is not an error worth reporting:
    // the browser will try again on the next navigation.
    registration.update().catch(() => undefined);
  };

  setInterval(check, UPDATE_INTERVAL_MS);

  // The moment a phone comes back to the app is the moment a stale build is
  // most likely and cheapest to replace.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', check);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // Registered as soon as this module runs, not on `load`. `load` waits for
  // every image, font and stylesheet in the document, and the whole of that
  // wait is time in which somebody who has just installed the app can walk out
  // of signal with no worker installed at all. Registration does not compete
  // with the page for bandwidth in any way that matters — the precache is one
  // extra request for files the browser has already been asked for.
  navigator.serviceWorker
    .register('/sw.js', {
      scope: '/',
      // Never let the HTTP cache answer for the worker script. If it does,
      // a deploy can be invisible for as long as the cached copy lives, and
      // the app becomes unfixable without clearing site data by hand.
      updateViaCache: 'none',
    })
    .then(scheduleUpdates)
    .catch((cause: unknown) => {
      // Warn rather than throw. Everything except offline punching works
      // without a worker, and taking the app down because the PWA layer
      // failed would be the wrong trade — but it must not pass in silence
      // either, because offline punching is what it is here for.
      console.warn(
        'Service worker registration failed; offline punching will not survive a reload.',
        cause,
      );
    });
}

registerServiceWorker();
