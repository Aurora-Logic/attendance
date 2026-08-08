import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { SyncRecord } from "@attendance/shared"

import { Outbox, Watermarks } from "./queue"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tally-agent-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const record = (name: string, alterId = 1): SyncRecord => ({
  entity: "customer",
  tallyGuid: `guid-${name}`,
  name,
  alterId,
  updatedAt: "2026-08-08T10:00:00.000Z",
  fields: {},
})

describe("Outbox", () => {
  it("survives a restart with the batch still in it", () => {
    // The point of the whole class: Tally's AlterID has already moved past
    // these records, so losing them loses the change for good.
    const first = new Outbox(dir)
    first.enqueue("Delta", [record("Acme")], "2026-08-08T10:00:00.000Z")

    const second = new Outbox(dir)
    expect(second.size).toBe(1)
    expect(second.peek()?.records[0].name).toBe("Acme")
  })

  it("hands batches back oldest first, so a later edit is not undone by an earlier one", () => {
    const outbox = new Outbox(dir)
    outbox.enqueue("Delta", [record("First")], "2026-08-08T10:00:00.000Z")
    outbox.enqueue("Delta", [record("Second")], "2026-08-08T10:01:00.000Z")
    expect(outbox.peek()?.records[0].name).toBe("First")
    outbox.ack(outbox.peek()!.seq)
    expect(outbox.peek()?.records[0].name).toBe("Second")
  })

  it("only forgets a batch once it is acknowledged", () => {
    const outbox = new Outbox(dir)
    const batch = outbox.enqueue("Delta", [record("Acme")], "2026-08-08T10:00:00.000Z")!
    expect(new Outbox(dir).size).toBe(1)
    outbox.ack(batch.seq)
    expect(new Outbox(dir).size).toBe(0)
  })

  it("ignores an empty batch instead of queueing nothing", () => {
    const outbox = new Outbox(dir)
    expect(outbox.enqueue("Delta", [], "2026-08-08T10:00:00.000Z")).toBeNull()
    expect(outbox.size).toBe(0)
  })

  it("counts the records waiting, not just the batches", () => {
    const outbox = new Outbox(dir)
    outbox.enqueue("Delta", [record("A"), record("B")], "2026-08-08T10:00:00.000Z")
    outbox.enqueue("Delta", [record("C")], "2026-08-08T10:01:00.000Z")
    expect(outbox.size).toBe(2)
    expect(outbox.recordCount).toBe(3)
  })

  it("starts clean after a power cut left a half-written file, and keeps the wreckage", () => {
    // A corrupt queue file that crashes on load would stop the connector for
    // good, which is far worse than losing one batch.
    writeFileSync(join(dir, "outbox.json"), '{"batches": [{"seq": 1, "rec', "utf8")
    const outbox = new Outbox(dir)
    expect(outbox.size).toBe(0)
    expect(readFileSync(join(dir, "outbox.json.corrupt"), "utf8")).toContain('{"batches"')
  })

  it("drops the oldest rather than filling the disk", () => {
    const outbox = new Outbox(dir)
    for (let index = 0; index < 520; index++) {
      outbox.enqueue("Delta", [record(`R${index}`)], "2026-08-08T10:00:00.000Z")
    }
    expect(outbox.size).toBe(500)
    expect(outbox.dropped).toBe(20)
    expect(outbox.peek()?.records[0].name).toBe("R20")
  })
})

describe("Watermarks", () => {
  it("remembers how far each entity was read, across restarts", () => {
    const first = new Watermarks(dir)
    first.set("customer", 140)
    expect(new Watermarks(dir).get("customer")).toBe(140)
  })

  it("never moves backwards — an out-of-order batch must not force a re-read of everything", () => {
    const marks = new Watermarks(dir)
    marks.set("customer", 140)
    marks.set("customer", 90)
    expect(marks.get("customer")).toBe(140)
  })

  it("treats an unknown entity as never read", () => {
    expect(new Watermarks(dir).get("item")).toBe(0)
  })

  it("falls back to re-reading rather than crashing on a damaged file", () => {
    writeFileSync(join(dir, "watermarks.json"), "not json", "utf8")
    expect(new Watermarks(dir).get("customer")).toBe(0)
  })
})
