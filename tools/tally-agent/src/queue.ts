import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { SyncRecord } from "@attendance/shared"

/**
 * The outbox.
 *
 * The whole reason the connector exists is that Tally is only reachable from
 * one machine on one LAN. That machine loses its internet connection, gets
 * rebooted at 6pm, and runs on a broadband line that drops. A batch read out of
 * Tally and then lost to a failed HTTP call is a change nobody can recover,
 * because Tally's AlterID has already moved past it.
 *
 * So: anything read from Tally lands on disk before it is sent, and is only
 * removed once the server has acknowledged it.
 */

export interface QueuedBatch {
  /** Monotonic within a file; used only for ordering and de-duplication. */
  seq: number
  company: string
  records: SyncRecord[]
  queuedAt: string
}

const MAX_BATCHES = 500

export class Outbox {
  private readonly path: string
  private batches: QueuedBatch[] = []
  private nextSeq = 1
  /** Batches dropped because the queue was full; reported, never silent. */
  dropped = 0

  constructor(stateDir: string, fileName = "outbox.json") {
    mkdirSync(stateDir, { recursive: true })
    this.path = join(stateDir, fileName)
    this.read()
  }

  private read() {
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as {
        batches?: QueuedBatch[]
        nextSeq?: number
      }
      this.batches = Array.isArray(parsed.batches) ? parsed.batches : []
      this.nextSeq = typeof parsed.nextSeq === "number" ? parsed.nextSeq : this.batches.length + 1
    } catch {
      // A half-written file from a power cut must not stop the agent for good.
      // Keep the damaged copy so it can be inspected, and carry on empty.
      try {
        renameSync(this.path, `${this.path}.corrupt`)
      } catch {
        /* best effort */
      }
      this.batches = []
      this.nextSeq = 1
    }
  }

  private write() {
    // Write beside the target and rename: a crash mid-write leaves the previous
    // good file intact rather than a truncated one.
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify({ nextSeq: this.nextSeq, batches: this.batches }, null, 2), "utf8")
    renameSync(temporary, this.path)
  }

  get size(): number {
    return this.batches.length
  }

  get recordCount(): number {
    return this.batches.reduce((total, batch) => total + batch.records.length, 0)
  }

  /** Add a batch to the back of the queue. */
  enqueue(company: string, records: SyncRecord[], queuedAt: string): QueuedBatch | null {
    if (records.length === 0) return null
    const batch: QueuedBatch = { seq: this.nextSeq++, company, records, queuedAt }
    this.batches.push(batch)
    while (this.batches.length > MAX_BATCHES) {
      // An unbounded queue on a disk that fills up takes the whole PC with it.
      // The oldest goes first, and the count is surfaced by the caller.
      this.batches.shift()
      this.dropped += 1
    }
    this.write()
    return batch
  }

  /** The oldest batch, or null. Order matters: later edits must not be undone by earlier ones. */
  peek(): QueuedBatch | null {
    return this.batches[0] ?? null
  }

  /** Remove a batch once the server has it. */
  ack(seq: number) {
    const before = this.batches.length
    this.batches = this.batches.filter((batch) => batch.seq !== seq)
    if (this.batches.length !== before) this.write()
  }
}

/**
 * How far each entity has been read from Tally.
 *
 * Kept separately from the outbox because it survives a queue reset: forgetting
 * the watermark means re-reading and re-pushing every master, which is slow but
 * safe; forgetting the outbox means losing changes, which is not.
 */
export class Watermarks {
  private readonly path: string
  private values: Record<string, number> = {}

  constructor(stateDir: string, fileName = "watermarks.json") {
    mkdirSync(stateDir, { recursive: true })
    this.path = join(stateDir, fileName)
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, number>
        if (parsed && typeof parsed === "object") this.values = parsed
      } catch {
        this.values = {}
      }
    }
  }

  get(key: string): number {
    const value = this.values[key]
    return typeof value === "number" && Number.isFinite(value) ? value : 0
  }

  set(key: string, value: number) {
    if (value <= this.get(key)) return
    this.values[key] = value
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(this.values, null, 2), "utf8")
    renameSync(temporary, this.path)
  }
}
