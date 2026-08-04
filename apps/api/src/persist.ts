import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { FastifyInstance } from "fastify"

import { seedStore, type Store } from "./store"

/**
 * Dev persistence: the store is plain data, so it round-trips through one JSON
 * file and survives API restarts. Prisma/Postgres replaces this wholesale —
 * nothing above the store knows it exists. Tests never touch it: they call
 * seedStore()/buildServer() directly.
 */

export function loadStore(path: string): Store {
  try {
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw) as Partial<Store>
    // Merge over a fresh seed so new fields added since the file was written
    // (matrix keys, settings, branding) exist with defaults.
    const seed = seedStore()
    return {
      ...seed,
      ...parsed,
      settings: { ...seed.settings, ...parsed.settings },
      matrix: { ...seed.matrix, ...parsed.matrix },
      branding: { ...seed.branding, ...parsed.branding },
    }
  } catch {
    return seedStore()
  }
}

export function persistOnWrite(app: FastifyInstance, store: Store, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  let timer: NodeJS.Timeout | null = null

  app.addHook("onResponse", async (request) => {
    if (request.method === "GET") return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        writeFileSync(path, JSON.stringify(store))
      } catch (error) {
        app.log.error?.(error)
      }
    }, 300)
  })
}
