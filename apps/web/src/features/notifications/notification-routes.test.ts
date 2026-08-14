import { NOTIFICATION_EVENT_ROUTES, NOTIFICATION_EVENT_TYPES } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { ALL_NAV_ITEMS } from '@/lib/nav';

// Vite's `?raw` rather than `node:fs`: this app's tsconfig declares
// `types: ["vite/client"]` and no node types, so a filesystem read here does
// not typecheck. The import is also resolved by the bundler, which means a
// moved or renamed `App.tsx` is a build error rather than a test that quietly
// reads nothing.
import APP_SOURCE from '../../App.tsx?raw';

/**
 * Every notification has to open something that exists.
 *
 * This is a real defect that shipped and survived: eight of the thirteen
 * templates named a path this app has never rendered -- `/leave/{id}`,
 * `/attendance/periods`, `/punch-audit/{id}`, `/approvals/{id}` -- and every
 * one of them would have dropped the reader on the not-found placeholder.
 * Nothing caught it because until the bell existed there was no way to click a
 * notification, so the wrong destination had no observable consequence.
 *
 * The check reads the *router*, not a list written down beside it. A test that
 * asserted against its own copy of the route table would pass on the day
 * somebody deleted a route.
 */

/**
 * The paths `<Route path="…">` declares, plus the index route.
 *
 * A source scan rather than a render, for the reason `check-guide-anchors.mjs`
 * gives: rendering the router means booting the whole app, and what is being
 * asserted here is a static fact about the route table.
 */
function declaredRoutes(): Set<string> {
  const routes = new Set<string>(['/']);
  for (const match of APP_SOURCE.matchAll(/<Route\s+path="([^"]+)"/gu)) {
    const path = match[1];
    if (path === undefined || path === '*') continue;
    routes.add(`/${path}`);
  }
  // The placeholder routes are generated from the nav table rather than
  // written out, so they are declared there instead.
  for (const item of ALL_NAV_ITEMS) routes.add(item.to);
  return routes;
}

describe('notification destinations resolve to real routes', () => {
  it('finds the route table it is checking against', () => {
    const routes = declaredRoutes();
    // A scan that goes blind must not pass by finding less. Twenty is well
    // under the real count and well over anything a broken regex would find.
    expect(routes.size).toBeGreaterThan(20);
    expect(routes.has('/my-attendance')).toBe(true);
    expect(routes.has('/period-lock')).toBe(true);
  });

  it('has a destination for every event in the catalogue', () => {
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      expect(NOTIFICATION_EVENT_ROUTES[eventType]).toBeDefined();
    }
  });

  it('points every event at a route this app renders', () => {
    const routes = declaredRoutes();
    const dead = NOTIFICATION_EVENT_TYPES.filter(
      (eventType) => !routes.has(NOTIFICATION_EVENT_ROUTES[eventType]),
    ).map((eventType) => `${eventType} -> ${NOTIFICATION_EVENT_ROUTES[eventType]}`);

    expect(dead).toEqual([]);
  });

  it('rejects the paths the catalogue used to carry', () => {
    // Falsification: these are the exact values that were in the templates,
    // and the assertion above has to fail for each of them.
    const routes = declaredRoutes();
    // `/regularizations` was on this list while that slice had no screen. It
    // shipped one, so the path is real now and the assertion above covers it.
    for (const stale of ['/leave', '/attendance/periods', '/punch-audit']) {
      expect(routes.has(stale)).toBe(false);
    }
  });
});
