import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SyncRecord } from "@attendance/shared"

import { drainOutbox } from "./agent"
import { loadConfig } from "./config"
import { Outbox, Watermarks } from "./queue"

/**
 * The connector's failure behaviour, which is most of what it is for. Every
 * case here is one where the obvious implementation loses somebody's data or
 * stops syncing without saying so.
 */

let dir: string
const realFetch = globalThis.fetch

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tally-agent-drain-"))
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

const config = () =>
  loadConfig({
    file: {
      apiUrl: "https://ops.delta-traders.example",
      agentSecret: "a".repeat(48),
      company: "Delta Traders",
    },
    defaultStateDir: dir,
  })

const record = (name: string): SyncRecord => ({
  entity: "customer",
  tallyGuid: `guid-${name}`,
  name,
  alterId: 5,
  updatedAt: "2026-08-08T10:00:00.000Z",
  fields: {},
})

const state = () => ({
  outbox: new Outbox(dir),
  watermarks: new Watermarks(dir),
  lastTallyProblem: null as string | null,
  tallyQuietTicks: 0,
})

/** A fetch that answers with the given statuses in order. */
function stubFetch(replies: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = []
  let index = 0
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const request = init as { body?: string }
    calls.push({ url: String(url), body: request?.body ? JSON.parse(request.body) : null })
    const reply = replies[Math.min(index++, replies.length - 1)]
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body ?? {}),
    } as Response
  }) as unknown as typeof fetch
  return calls
}

describe("drainOutbox", () => {
  it("sends what is queued and clears it once the server has it", async () => {
    const current = state()
    current.outbox.enqueue("Delta Traders", [record("Acme")], "2026-08-08T10:00:00.000Z")
    const calls = stubFetch([{ status: 200, body: { pulled: 1, conflicts: 0 } }])

    await drainOutbox(config(), current)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/tally/sync/push")
    expect(current.outbox.size).toBe(0)
    // And it is gone from disk too, not just from memory.
    expect(new Outbox(dir).size).toBe(0)
  })

  it("keeps the batch when the network is down, and stops trying this pass", async () => {
    const current = state()
    current.outbox.enqueue("Delta Traders", [record("Acme")], "2026-08-08T10:00:00.000Z")
    current.outbox.enqueue("Delta Traders", [record("Zenith")], "2026-08-08T10:01:00.000Z")
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })
    }) as unknown as typeof fetch

    await drainOutbox(config(), current)

    expect(current.outbox.size).toBe(2)
    // One attempt, not one per batch: the line is down, and hammering it just
    // delays the pass.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it("does not let a batch the server always rejects block every batch behind it", async () => {
    // Head-of-line blocking is the failure that turns a connector into a
    // connector that silently stopped: one bad batch, and nothing syncs again.
    const current = state()
    current.outbox.enqueue("Delta Traders", [record("Bad")], "2026-08-08T10:00:00.000Z")
    current.outbox.enqueue("Delta Traders", [record("Good")], "2026-08-08T10:01:00.000Z")
    const calls = stubFetch([
      { status: 400, body: { error: "BAD_REQUEST" } },
      { status: 200, body: { pulled: 1, conflicts: 0 } },
    ])

    await drainOutbox(config(), current)

    expect(calls).toHaveLength(2)
    expect(current.outbox.size).toBe(0)
  })

  it("drops a batch aimed at the wrong company rather than retrying it forever", async () => {
    const current = state()
    current.outbox.enqueue("Wrong Company", [record("Acme")], "2026-08-08T10:00:00.000Z")
    stubFetch([{ status: 409, body: { error: "COMPANY_MISMATCH" } }])

    await drainOutbox(config(), current)

    expect(current.outbox.size).toBe(0)
  })

  it("keeps the batch when the secret is rejected, because that is fixable", async () => {
    // A wrong secret is a typo in a config file. Throwing the data away over it
    // would be unforgivable.
    const current = state()
    current.outbox.enqueue("Delta Traders", [record("Acme")], "2026-08-08T10:00:00.000Z")
    stubFetch([{ status: 401, body: { error: "AGENT_UNAUTHENTICATED" } }])

    await drainOutbox(config(), current)

    expect(current.outbox.size).toBe(1)
  })

  it("sends the secret on every call", async () => {
    const current = state()
    current.outbox.enqueue("Delta Traders", [record("Acme")], "2026-08-08T10:00:00.000Z")
    const sent = vi.fn(
      async (_url: unknown, _init: unknown) =>
        ({ ok: true, status: 200, text: async () => "{}" }) as Response
    )
    globalThis.fetch = sent as unknown as typeof fetch

    await drainOutbox(config(), current)

    const init = sent.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["x-agent-secret"]).toBe("a".repeat(48))
  })
})
