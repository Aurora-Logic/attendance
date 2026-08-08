import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  collectionRequestXml,
  importMasterXml,
  parseCollection,
  parseImportResponse,
  tallyError,
  type SyncRecord,
} from "@attendance/shared"

import { loadConfig, ConfigError, SAMPLE_CONFIG, type AgentConfig } from "./config"
import { Outbox, Watermarks } from "./queue"
import { log, describeNetworkError } from "./log"

/**
 * The Tally connector.
 *
 * Runs on the Windows machine where Tally is installed, because Tally's XML
 * gateway listens on the local network only and only while Tally is open.
 * It reads masters from Tally, sends them to the attendance server, and writes
 * back the masters this side created.
 *
 * Design rules, all of them learned from what breaks on a real shop-floor PC:
 *
 *  • Nothing read from Tally is sent without first being written to disk.
 *    Tally's AlterID moves on; a batch lost to a dropped connection is a change
 *    nobody can find again.
 *  • Tally being closed is normal, not an error. The user shuts it at 6pm.
 *  • The heartbeat is sent even when Tally is unreachable, so the status screen
 *    can tell "connector is dead" from "Tally is closed".
 *  • It never exits on an error it might recover from. A connector that stops
 *    at 2am is a connector nobody notices until the month-end close.
 */

const AGENT_VERSION = "1.0.0"
const HTTP_TIMEOUT_MS = 30_000

/**
 * Where the executable lives, so config sits beside it rather than buried in a
 * home directory the operator would have to be told how to find. The bundle is
 * CommonJS, so `__dirname` is the install folder; running from source in dev
 * has no such folder and falls back to the working directory.
 */
function installDir(): string {
  return typeof __dirname === "string" ? __dirname : process.cwd()
}

function readConfigFile(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } catch (error) {
    throw new ConfigError(
      `${path} is not valid JSON (${(error as Error).message}). ` +
        "A stray comma or a missing quote will do it — open it in Notepad and check."
    )
  }
}

/** POST with a timeout. `fetch` will otherwise hang forever against a half-open socket. */
async function postWithTimeout(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = HTTP_TIMEOUT_MS
): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method: "POST", body, headers, signal: controller.signal })
    return { status: response.status, text: await response.text() }
  } finally {
    clearTimeout(timer)
  }
}

/* --------------------------------------------------------------- Tally I/O */

async function askTally(config: AgentConfig, xml: string): Promise<string> {
  // The charset has to match what is actually on the wire. `fetch` sends a
  // JavaScript string as UTF-8, and Tally believes the header — declaring
  // utf-16 here turns every name into mojibake in the books.
  const { status, text } = await postWithTimeout(config.tallyUrl, xml, {
    "Content-Type": "text/xml; charset=utf-8",
  })
  if (status !== 200) throw new Error(`Tally answered HTTP ${status}.`)
  const problem = tallyError(text)
  if (problem) throw new Error(problem)
  return text
}

async function readMasters(config: AgentConfig, seenAt: string) {
  const all: SyncRecord[] = []
  let skipped = 0
  for (const collection of ["Ledger", "StockItem"] as const) {
    const xml = await askTally(config, collectionRequestXml({ company: config.company, collection }))
    const parsed = parseCollection(xml, collection, seenAt)
    all.push(...parsed.records)
    skipped += parsed.skipped
  }
  return { records: all, skipped }
}

/* ----------------------------------------------------------- server I/O */

interface ServerResult<T> {
  ok: boolean
  status: number
  body: T | null
  error: string | null
}

async function callServer<T>(
  config: AgentConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<ServerResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-agent-secret": config.agentSecret,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const text = await response.text()
    let body: T | null = null
    try {
      body = text ? (JSON.parse(text) as T) : null
    } catch {
      body = null
    }
    if (!response.ok) {
      return { ok: false, status: response.status, body, error: describeServerError(response.status, text) }
    }
    return { ok: true, status: response.status, body, error: null }
  } catch (error) {
    return { ok: false, status: 0, body: null, error: describeNetworkError(error) }
  } finally {
    clearTimeout(timer)
  }
}

function describeServerError(status: number, text: string): string {
  if (status === 401)
    return "The server rejected the agent secret. Check that agentSecret in tally-agent.json matches TALLY_AGENT_SECRET on the server."
  if (status === 409)
    return `The server has this connector registered against a different company. ${text.slice(0, 200)}`
  if (status === 400) return `The server refused the batch: ${text.slice(0, 300)}`
  return `The server answered HTTP ${status}. ${text.slice(0, 200)}`
}

/* ------------------------------------------------------------- one pass */

interface PassState {
  outbox: Outbox
  watermarks: Watermarks
  /** Repeated identical failures are logged once, then counted. */
  lastTallyProblem: string | null
  tallyQuietTicks: number
}

async function drainOutbox(config: AgentConfig, state: PassState): Promise<boolean> {
  let batch = state.outbox.peek()
  let sentAny = false
  while (batch) {
    const result = await callServer<{ pulled: number; conflicts: number }>(config, "/tally/sync/push", {
      method: "POST",
      body: { agentVersion: AGENT_VERSION, company: batch.company, records: batch.records },
    })

    if (result.ok) {
      state.outbox.ack(batch.seq)
      sentAny = true
      const summary = result.body
      log.info(
        `Sent ${batch.records.length} master(s)` +
          (summary ? ` — ${summary.pulled} applied, ${summary.conflicts} conflict(s)` : "") +
          (state.outbox.size > 0 ? `, ${state.outbox.size} batch(es) still queued` : "")
      )
    } else if (result.status === 400 || result.status === 409) {
      // The server will refuse this batch every time it is offered. Keeping it
      // at the head of the queue blocks every later batch behind it forever.
      state.outbox.ack(batch.seq)
      log.error(`Dropped a batch the server will not accept. ${result.error}`)
    } else {
      log.warn(`Could not reach the server; ${state.outbox.size} batch(es) waiting. ${result.error}`)
      return sentAny
    }

    batch = state.outbox.peek()
  }
  return sentAny
}

async function readAndQueue(config: AgentConfig, state: PassState) {
  const seenAt = new Date().toISOString()
  let harvest: { records: SyncRecord[]; skipped: number }
  try {
    harvest = await readMasters(config, seenAt)
    if (state.lastTallyProblem) {
      log.info("Tally is answering again.")
      state.lastTallyProblem = null
      state.tallyQuietTicks = 0
    }
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error)
    // Tally being closed is the normal end of a working day, not a fault. Say
    // it once and then stay quiet, or the log becomes unreadable overnight.
    if (problem !== state.lastTallyProblem) {
      log.warn(`Tally is not answering: ${problem}`)
      log.warn("This is expected when Tally is closed. Nothing is lost — the connector keeps trying.")
      state.lastTallyProblem = problem
      state.tallyQuietTicks = 0
    } else {
      state.tallyQuietTicks += 1
    }
    return
  }

  if (harvest.skipped > 0)
    log.warn(`${harvest.skipped} master(s) had no GUID and were left alone rather than matched by name.`)

  // Only what Tally says has changed. Its AlterID is monotonic per company, so
  // one watermark per entity is enough to skip the rest.
  const changed = harvest.records.filter((record) => record.alterId > state.watermarks.get(record.entity))
  if (changed.length === 0) return

  state.outbox.enqueue(config.company, changed, seenAt)
  for (const record of changed) state.watermarks.set(record.entity, record.alterId)
  log.info(`Read ${changed.length} changed master(s) from Tally.`)
}

async function writeBack(config: AgentConfig) {
  if (!config.writeBack) return

  const pending = await callServer<{ records: SyncRecord[] }>(config, "/tally/sync/pull", { method: "GET" })
  if (!pending.ok || !pending.body) return
  const records = pending.body.records ?? []
  if (records.length === 0) return

  let written = 0
  for (const record of records) {
    try {
      const xml = await askTally(config, importMasterXml({ company: config.company, record }))
      const result = parseImportResponse(xml)
      if (result.errors > 0) {
        log.error(`Tally refused "${record.name}": ${result.message ?? "no reason given"}`)
        continue
      }
      written += result.created + result.altered
    } catch (error) {
      log.warn(`Could not write "${record.name}" into Tally: ${(error as Error).message}`)
      // Nothing to clean up: the server still holds it, so the next pass retries.
      return
    }
  }
  if (written > 0) log.info(`Wrote ${written} master(s) into Tally.`)
}

async function beat(config: AgentConfig, state: PassState) {
  const result = await callServer(config, "/tally/sync/heartbeat", {
    method: "POST",
    body: {
      agentVersion: AGENT_VERSION,
      company: config.company,
      tallyReachable: state.lastTallyProblem === null,
      queuedBatches: state.outbox.size,
      queuedRecords: state.outbox.recordCount,
    },
  })
  if (!result.ok && result.status === 401) {
    // Worth shouting about: nothing will ever sync until somebody fixes it.
    log.error(result.error ?? "The server rejected the agent secret.")
  }
}

/* ---------------------------------------------------------------- startup */

export async function main() {
  const dir = installDir()
  const configPath = process.env.TALLY_AGENT_CONFIG ?? join(dir, "tally-agent.json")

  let config: AgentConfig
  try {
    const file = readConfigFile(configPath)
    if (!file && !process.env.TALLY_AGENT_API_URL) {
      // First run with nothing set up: leave a filled-in template rather than a
      // complaint about a file the person has never heard of.
      writeFileSync(configPath, JSON.stringify(SAMPLE_CONFIG, null, 2), "utf8")
      log.error(`No configuration found, so a template was written to:\n  ${configPath}`)
      log.error("Fill it in and start the connector again.")
      process.exitCode = 1
      return
    }
    config = loadConfig({ file, env: process.env, defaultStateDir: resolve(dir, "state") })
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(error.message)
      log.error(`Configuration file: ${configPath}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  const state: PassState = {
    outbox: new Outbox(config.stateDir),
    watermarks: new Watermarks(config.stateDir),
    lastTallyProblem: null,
    tallyQuietTicks: 0,
  }

  log.info(`Tally connector ${AGENT_VERSION}`)
  log.info(`  Company : ${config.company}`)
  log.info(`  Tally   : ${config.tallyUrl}`)
  log.info(`  Server  : ${config.apiUrl}`)
  log.info(`  Every   : ${config.pollSeconds}s${config.writeBack ? "" : " (read only)"}`)
  if (state.outbox.size > 0) log.info(`  Queued  : ${state.outbox.recordCount} master(s) from a previous run`)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    log.info("Stopping. Anything queued stays on disk and is sent on the next start.")
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  // One pass. Every step is independently fallible and none of them may take
  // the loop down — Windows restarts a crashed service on its own schedule,
  // which is exactly the delay that makes a sync look broken.
  const pass = async () => {
    try {
      await readAndQueue(config, state)
      await drainOutbox(config, state)
      await writeBack(config)
      await beat(config, state)
    } catch (error) {
      log.error(`Unexpected problem, continuing: ${(error as Error).stack ?? String(error)}`)
    }
  }

  await pass()
  const timer = setInterval(() => void pass(), config.pollSeconds * 1000)
  // Nothing else keeps the process alive, and unref'ing would let it exit.
  timer.ref()
}

export { drainOutbox, readAndQueue, writeBack }
