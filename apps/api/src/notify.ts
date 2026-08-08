import type { NotificationKind } from "@attendance/shared"

import { id, type Store } from "./store"

/**
 * One writer for the notification feed, shared by the request routes and the
 * nightly sweep. Two copies would be two places for the cap and the shape to
 * drift, and the sweep's escalation notices are the ones nobody is watching
 * when they break.
 */

/**
 * Per-person cap. A feed that grows without bound eventually becomes the
 * largest thing in the store, and nobody reads a two-year-old notification.
 */
const FEED_LIMIT_PER_EMPLOYEE = 100

export interface NotifyInput {
  employeeId: string
  kind: NotificationKind
  title: string
  body: string
  href: string
}

export function makeNotifier(store: Store) {
  return (input: NotifyInput): void => {
    store.notifications.unshift({
      id: id(store, "ntf"),
      employeeId: input.employeeId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      href: input.href,
      createdAt: new Date().toISOString(),
      readAt: null,
    })

    const mine = store.notifications.filter((entry) => entry.employeeId === input.employeeId)
    if (mine.length > FEED_LIMIT_PER_EMPLOYEE) {
      const dropped = new Set(mine.slice(FEED_LIMIT_PER_EMPLOYEE).map((entry) => entry.id))
      store.notifications = store.notifications.filter((entry) => !dropped.has(entry.id))
    }
  }
}
