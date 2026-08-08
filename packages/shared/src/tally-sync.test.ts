import { describe, expect, it } from "vitest"

import { agentHealth, reconcile, syncRecordSchema } from "./tally-sync"

const T = (iso: string) => iso

describe("reconcile — who wins when both sides may edit", () => {
  const lastSynced = { updatedAt: T("2026-08-01T10:00:00.000Z"), alterId: 100 }

  it("pulls what only exists in Tally, pushes what only exists here", () => {
    expect(
      reconcile({ app: null, tally: { updatedAt: T("2026-08-02T10:00:00Z"), alterId: 101 }, lastSynced: null })
    ).toMatchObject({ action: "pull" })
    expect(reconcile({ app: { updatedAt: T("2026-08-02T10:00:00Z") }, tally: null, lastSynced: null })).toMatchObject(
      { action: "push" }
    )
  })

  it("does nothing when neither side moved", () => {
    expect(
      reconcile({
        app: { updatedAt: T("2026-08-01T09:00:00Z") },
        tally: { updatedAt: T("2026-08-01T09:00:00Z"), alterId: 100 },
        lastSynced,
      })
    ).toMatchObject({ action: "none" })
  })

  it("a one-sided edit is never reported as a conflict", () => {
    // This is what keeps the conflict log small enough to be read.
    expect(
      reconcile({
        app: { updatedAt: T("2026-08-01T09:00:00Z") },
        tally: { updatedAt: T("2026-08-03T09:00:00Z"), alterId: 140 },
        lastSynced,
      })
    ).toMatchObject({ action: "pull", reason: "Changed in Tally only." })

    expect(
      reconcile({
        app: { updatedAt: T("2026-08-03T09:00:00Z") },
        tally: { updatedAt: T("2026-08-01T09:00:00Z"), alterId: 100 },
        lastSynced,
      })
    ).toMatchObject({ action: "push", reason: "Changed here only." })
  })

  it("only calls it a conflict when both sides changed since the last sync", () => {
    const decision = reconcile({
      app: { updatedAt: T("2026-08-04T09:00:00Z") },
      tally: { updatedAt: T("2026-08-03T09:00:00Z"), alterId: 150 },
      lastSynced,
    })
    expect(decision.action).toBe("conflict")
    expect(decision).toMatchObject({ winner: "app" })
  })

  it("the newer edit wins, and a tie goes to Tally", () => {
    const same = T("2026-08-04T09:00:00.000Z")
    expect(
      reconcile({
        app: { updatedAt: same },
        tally: { updatedAt: same, alterId: 150 },
        lastSynced,
      })
    ).toMatchObject({ action: "conflict", winner: "tally" })
  })

  it("two records that predate the first sync are a genuine conflict", () => {
    expect(
      reconcile({
        app: { updatedAt: T("2026-07-01T09:00:00Z") },
        tally: { updatedAt: T("2026-07-02T09:00:00Z"), alterId: 5 },
        lastSynced: null,
      })
    ).toMatchObject({ action: "conflict", winner: "tally" })
  })

  it("an unreadable timestamp defers to Tally rather than winning by accident", () => {
    expect(
      reconcile({
        app: { updatedAt: "yesterday-ish" },
        tally: { updatedAt: T("2026-08-03T09:00:00Z"), alterId: 150 },
        lastSynced,
      })
    ).toMatchObject({ action: "pull" })
  })
})

describe("syncRecordSchema", () => {
  const record = {
    entity: "customer",
    tallyGuid: "abc-123",
    name: "Acme Traders",
    alterId: 42,
    updatedAt: "2026-08-08T10:00:00.000Z",
    fields: { gstin: "27AAAPZ1234C1ZV" },
  }

  it("accepts a well-formed record", () => {
    expect(syncRecordSchema.safeParse(record).success).toBe(true)
  })

  it("refuses one with no Tally identity — the name is not a key", () => {
    expect(syncRecordSchema.safeParse({ ...record, tallyGuid: "" }).success).toBe(false)
  })

  it("refuses an unknown entity", () => {
    expect(syncRecordSchema.safeParse({ ...record, entity: "invoice" }).success).toBe(false)
  })
})

describe("agentHealth", () => {
  const now = "2026-08-08T12:00:00.000Z"

  it("distinguishes never-connected from live from stale", () => {
    expect(agentHealth(null, now).state).toBe("never")
    expect(agentHealth("2026-08-08T11:58:00.000Z", now).state).toBe("live")
    // A sync layer that stopped silently shows masters that are quietly stale.
    expect(agentHealth("2026-08-08T11:00:00.000Z", now).state).toBe("stale")
  })

  it("reports how long it has been quiet", () => {
    expect(agentHealth("2026-08-08T11:00:00.000Z", now).staleForMs).toBe(60 * 60 * 1000)
  })
})
