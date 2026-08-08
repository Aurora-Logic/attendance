import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { FastifyInstance } from "fastify"

import { operationsSettingsSchema } from "@attendance/shared"

import { seedStore, type Store } from "./store"

/**
 * Dev persistence: the store is plain data, so it round-trips through one JSON
 * file and survives API restarts. Prisma/Postgres replaces this wholesale —
 * nothing above the store knows it exists. Tests never touch it: they call
 * seedStore()/buildServer() directly.
 */

export function loadStore(path: string): Store {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    // No file yet — a genuinely fresh install. Seed is correct here.
    return seedStore()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Store>
    // Merge over a fresh seed so new fields added since the file was written
    // (matrix keys, settings, branding) exist with defaults.
    const seed = seedStore()
    return {
      ...seed,
      ...parsed,
      settings: { ...seed.settings, ...parsed.settings },
      // Merged per module so a module added since the file was written
      // arrives with its defaults rather than undefined.
      operations: operationsSettingsSchema.parse(parsed.operations ?? {}),
      matrix: { ...seed.matrix, ...parsed.matrix },
      branding: { ...seed.branding, ...parsed.branding },
      exportJobs: parsed.exportJobs ?? [],
      salaries: parsed.salaries ?? seed.salaries,
      monthLocks: parsed.monthLocks ?? [],
      payrollRuns: parsed.payrollRuns ?? [],
      notifications: parsed.notifications ?? [],
      pickLists: parsed.pickLists ?? [],
      packs: parsed.packs ?? [],
      consignments: parsed.consignments ?? [],
      pods: parsed.pods ?? [],
      // A file written before these sequences existed must not restart
      // numbering at 1 and collide with documents already issued.
      seq: { ...seed.seq, ...parsed.seq },
      tallyRecords: parsed.tallyRecords ?? [],
      tallyConflicts: parsed.tallyConflicts ?? [],
      tallyAgent: { ...seed.tallyAgent, ...parsed.tallyAgent },
    }
  } catch (error) {
    // The file exists but will not parse. Silently reseeding here would
    // replace live business data with demo rows and look like a working boot,
    // so the corrupt file is preserved for recovery and the process stops.
    const quarantine = `${path}.corrupt-${Date.now()}`
    try {
      renameSync(path, quarantine)
    } catch {
      /* best effort — the throw below is what matters */
    }
    throw new Error(
      `Data file ${path} is corrupt and was moved to ${quarantine}. ` +
        `Refusing to start with seed data over live records. ` +
        `Restore a backup and restart. Parse error: ${(error as Error).message}`
    )
  }
}

/**
 * Returns a synchronous flush. Writes are debounced by 300ms, so a process
 * killed inside that window would drop the last mutation — shutdown calls the
 * flush to close that gap.
 */
export function persistOnWrite(
  app: FastifyInstance,
  store: Store,
  path: string
): { flush: () => void } {
  mkdirSync(dirname(path), { recursive: true })
  let timer: NodeJS.Timeout | null = null

  // Write to a sibling temp file then rename. rename(2) is atomic within a
  // filesystem, so a crash mid-write leaves the previous good file intact
  // instead of a half-written one that fails to parse on the next boot.
  const write = () => {
    const temp = `${path}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(store))
      renameSync(temp, path)
    } catch (error) {
      app.log.error?.(error)
      try {
        rmSync(temp, { force: true })
      } catch {
        /* nothing further to do */
      }
    }
  }

  app.addHook("onResponse", async (request) => {
    if (request.method === "GET") return
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, 300)
  })

  return {
    flush: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      write()
    },
  }
}
