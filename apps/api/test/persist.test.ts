import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadStore } from "../src/persist"
import { id, safeNextId, seedStore } from "../src/store"

/**
 * What happens when the file on disk disagrees with the code that reads it.
 * Every case here produced silent data loss rather than an error.
 */

let dir: string
const pathFor = () => join(dir, "store.json")

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attendance-persist-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (store: unknown) => writeFileSync(pathFor(), JSON.stringify(store), "utf8")

describe("loadStore", () => {
  it("seeds when there is no file at all", () => {
    expect(loadStore(pathFor()).users.length).toBeGreaterThan(0)
  })

  it("never hands back a counter that is behind an id already in the file", () => {
    // A stale counter means every new record collides with an existing one.
    // It surfaced as two approvals sharing an id and React rendering one of
    // them away — a request that exists in the data, invisible on screen.
    const store = seedStore()
    store.nextId = 3
    store.approvals.push({ ...store.approvals[0], id: "req_281" })
    write(store)

    const loaded = loadStore(pathFor())
    expect(loaded.nextId).toBeGreaterThan(281)
    expect(id(loaded, "req")).toBe("req_282")
  })

  it("looks across every collection, not only the one that overflowed", () => {
    const store = seedStore()
    store.nextId = 2
    store.invoices.push({ ...seedStore().invoices[0], id: "inv_9001" })
    write(store)
    expect(loadStore(pathFor()).nextId).toBeGreaterThan(9001)
  })

  it("leaves a healthy counter alone rather than rewinding it", () => {
    const store = seedStore()
    store.nextId = 50_000
    write(store)
    expect(loadStore(pathFor()).nextId).toBe(50_000)
  })

  it("is not confused by an id that has no number on the end", () => {
    const store = seedStore()
    store.nextId = 7
    store.approvals.push({ ...store.approvals[0], id: "req_manual" })
    write(store)
    expect(loadStore(pathFor()).nextId).toBe(7)
  })

  it("fills in a module of settings the file predates", () => {
    const store = seedStore() as unknown as Record<string, unknown>
    delete store.operations
    write(store)
    expect(loadStore(pathFor()).operations.dispatch.requireLrNumber).toBe(true)
  })

  it("does not restart document numbering when the file predates a sequence", () => {
    const store = seedStore() as unknown as Record<string, unknown> & { seq: Record<string, number> }
    store.seq = { po: 12, grn: 3, est: 5, so: 4, ch: 2, inv: 7, ind: 1, exp: 0 }
    write(store)
    const loaded = loadStore(pathFor())
    expect(loaded.seq.po).toBe(12)
    // The new ones arrive at zero rather than undefined, which would have
    // produced "PL-2026-NaN".
    expect(loaded.seq.pick).toBe(0)
  })

  it("quarantines a corrupt file rather than reseeding over live data", () => {
    // Silently reseeding replaces a company's records with demo rows and looks
    // like a working boot.
    writeFileSync(pathFor(), "{ not json", "utf8")
    expect(() => loadStore(pathFor())).toThrow(/corrupt/)

    // It is moved aside, not deleted: the damaged file is the only copy of
    // whatever was in it.
    const quarantined = readdirSync(dir).find((name) => name.includes(".corrupt-"))
    expect(quarantined).toBeDefined()
    expect(readFileSync(join(dir, quarantined!), "utf8")).toBe("{ not json")
  })
})

describe("seedStore", () => {
  it("hands out ids past its own rows, not on top of them", () => {
    // The seed's approvals carry literal ids; a counter starting at 1 gives the
    // first new record one that already exists.
    const store = seedStore()
    const existing = new Set(store.approvals.map((row) => row.id))
    for (let index = 0; index < 20; index++) {
      expect(existing.has(id(store, "req"))).toBe(false)
    }
  })

  it("issues a unique id across every collection, not just approvals", () => {
    const store = seedStore()
    const seen = new Set<string>()
    for (const value of Object.values(store)) {
      if (!Array.isArray(value)) continue
      for (const row of value) {
        if (row && typeof row === "object" && "id" in row) seen.add(String((row as { id: unknown }).id))
      }
    }
    for (const prefix of ["req", "inv", "so", "pick"]) {
      for (let index = 0; index < 10; index++) {
        const next = id(store, prefix)
        expect(seen.has(next)).toBe(false)
        seen.add(next)
      }
    }
  })
})

describe("safeNextId", () => {
  it("re-bases past rows that arrived from somewhere else entirely", () => {
    // Database rows bring their own ids and are usually numbered far above a
    // freshly seeded counter. This is the guarantee the seed, the file loader
    // and the database hydration all share.
    const store = seedStore()
    store.nextId = 1
    store.approvals = [
      { ...seedStore().approvals[0], id: "req_145" } as (typeof store.approvals)[number],
    ]
    store.nextId = safeNextId(store)
    expect(id(store, "req")).toBe("req_146")
  })

  it("copes with a store whose collections are empty", () => {
    const store = seedStore()
    store.nextId = 5
    store.approvals = []
    expect(safeNextId(store)).toBeGreaterThanOrEqual(5)
  })
})
