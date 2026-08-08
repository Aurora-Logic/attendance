import { describe, expect, it } from "vitest"

import {
  notificationSchema,
  notificationTone,
  shouldEscalate,
  unreadCount,
  type Notification,
} from "./notifications"

const entry = (over: Partial<Notification> = {}): Notification => ({
  id: "n1",
  employeeId: "e1",
  kind: "APPROVAL_RAISED",
  title: "Leave request",
  body: "Kabir Singh · CL · 1 day",
  href: "/approvals",
  createdAt: "2026-08-08T09:00:00.000Z",
  readAt: null,
  ...over,
})

describe("notificationSchema", () => {
  it("accepts a well-formed entry and an explicit read timestamp", () => {
    expect(notificationSchema.safeParse(entry()).success).toBe(true)
    expect(
      notificationSchema.safeParse(entry({ readAt: "2026-08-08T10:00:00.000Z" })).success
    ).toBe(true)
  })

  it("rejects an unknown kind and a missing recipient", () => {
    expect(notificationSchema.safeParse({ ...entry(), kind: "SHOUT" }).success).toBe(false)
    const { employeeId, ...withoutRecipient } = entry()
    expect(notificationSchema.safeParse(withoutRecipient).success).toBe(false)
  })
})

describe("unreadCount", () => {
  it("counts only what has not been read", () => {
    expect(
      unreadCount([
        entry({ id: "a" }),
        entry({ id: "b", readAt: "2026-08-08T10:00:00.000Z" }),
        entry({ id: "c" }),
      ])
    ).toBe(2)
    expect(unreadCount([])).toBe(0)
  })
})

describe("notificationTone", () => {
  it("marks things needing attention as warnings", () => {
    expect(notificationTone("APPROVAL_ESCALATED")).toBe("warning")
    expect(notificationTone("COMP_OFF_EXPIRING")).toBe("warning")
    expect(notificationTone("APPROVAL_DECIDED")).toBe("success")
    expect(notificationTone("APPROVAL_RAISED")).toBe("info")
  })
})

describe("shouldEscalate", () => {
  const raised = "2026-08-05T09:00:00.000Z"

  it("waits the configured whole days before moving a request up", () => {
    expect(shouldEscalate(raised, 2, "2026-08-06T09:00:00.000Z")).toBe(false)
    expect(shouldEscalate(raised, 2, "2026-08-07T08:59:00.000Z")).toBe(false)
    expect(shouldEscalate(raised, 2, "2026-08-07T09:00:00.000Z")).toBe(true)
    expect(shouldEscalate(raised, 2, "2026-08-20T09:00:00.000Z")).toBe(true)
  })

  it("escalates immediately when the setting is zero days", () => {
    expect(shouldEscalate(raised, 0, raised)).toBe(true)
  })

  it("never escalates on an unparseable timestamp", () => {
    expect(shouldEscalate("not-a-date", 1, "2026-08-08T09:00:00.000Z")).toBe(false)
  })
})
