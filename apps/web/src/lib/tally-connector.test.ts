import { describe, expect, it } from "vitest"

import type { TallyStatus } from "@/lib/queries"
import { readConnector, sinceLabel } from "@/lib/tally-connector"

const agent = (patch: Partial<TallyStatus["agent"]> = {}): TallyStatus["agent"] => ({
  state: "live",
  staleForMs: 60_000,
  lastSeenAt: "2026-08-08T12:00:00.000Z",
  agentVersion: "1.0.0",
  company: "Delta Traders",
  lastPulled: 0,
  lastPushed: 12,
  tallyReachable: true,
  queuedRecords: 0,
  ...patch,
})

describe("readConnector", () => {
  it("says it is connected when it is", () => {
    const reading = readConnector(agent())
    expect(reading.tone).toBe("ok")
    expect(reading.detail).toContain("Delta Traders")
  })

  it("separates a dead connector from a closed Tally", () => {
    // The same silence on the wire, and opposite responses: one means go and
    // look at that PC, the other means wait until morning.
    const dead = readConnector(agent({ state: "stale", staleForMs: 3 * 60 * 60 * 1000 }))
    const closed = readConnector(agent({ tallyReachable: false }))

    expect(dead.tone).toBe("bad")
    expect(dead.headline).toContain("silent for 3 hours")
    expect(closed.tone).toBe("warn")
    expect(closed.detail).toContain("outside working hours")
  })

  it("reassures that a backlog is held rather than lost", () => {
    const reading = readConnector(agent({ tallyReachable: false, queuedRecords: 34 }))
    expect(reading.detail).toContain("34 change(s) are held safely")
  })

  it("treats never-connected as setup unfinished, not as a fault", () => {
    const reading = readConnector(agent({ state: "never" }))
    expect(reading.tone).toBe("warn")
    expect(reading.headline).toBe("Not connected yet")
  })

  it("does not claim Tally is closed just because an old connector never said", () => {
    // A connector predating the tallyReachable field reports null. Reading that
    // as "closed" would raise a warning on a system that is working perfectly.
    expect(readConnector(agent({ tallyReachable: null })).tone).toBe("ok")
  })

  it("reports the connector as dead even when it last said Tally was fine", () => {
    // Staleness outranks the last known Tally state — that reading is old too.
    expect(readConnector(agent({ state: "stale", tallyReachable: true })).tone).toBe("bad")
  })
})

describe("sinceLabel", () => {
  it("reads as a person would say it", () => {
    expect(sinceLabel(30_000)).toBe("just now")
    expect(sinceLabel(60_000)).toBe("1 minute ago")
    expect(sinceLabel(45 * 60_000)).toBe("45 minutes ago")
    expect(sinceLabel(60 * 60_000)).toBe("1 hour ago")
    expect(sinceLabel(5 * 60 * 60_000)).toBe("5 hours ago")
    expect(sinceLabel(26 * 60 * 60_000)).toBe("1 day ago")
    expect(sinceLabel(72 * 60 * 60_000)).toBe("3 days ago")
  })
})
