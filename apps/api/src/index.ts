import { fileURLToPath } from "node:url"

import { buildServer } from "./server"
import { exportsDir, startExportWorker, stopExports } from "./exports"
import { scheduleNightlyClose } from "./nightly"
import { makeNotifier } from "./notify"
import { hydrateFromDb } from "./repositories"
import { loadStore, persistOnWrite } from "./persist"

const port = Number(process.env.PORT ?? 3000)
// fileURLToPath, not .pathname — the repo path contains a space and .pathname
// percent-encodes it into a literal "%20" directory.
const dataFile =
  process.env.DATA_FILE ?? fileURLToPath(new URL("../.data/store.json", import.meta.url))

const store = loadStore(dataFile)
// Postgres is the system of record for attendance truth; the JSON file only
// carries what has no table yet. Hydration replaces the file's copy on boot.
const hydrated = await hydrateFromDb(store).catch(() => null)
if (hydrated) {
  console.log(
    `hydrated from postgres: ${hydrated.punches} punches · ${hydrated.approvals} approvals · ${hydrated.ledger} ledger rows`
  )
}
const filesDir = exportsDir(fileURLToPath(new URL("../.data", import.meta.url)))
const app = await buildServer(store, { exportsDir: filesDir })
const { flush } = persistOnWrite(app, store, dataFile)
// The sweep writes to the same feed the routes do, so escalation notices
// reach people rather than only appearing in a log line.
scheduleNightlyClose(store, console.log, makeNotifier(store))
void startExportWorker(store, filesDir)

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`api listening on :${port} · data file ${dataFile}`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

/**
 * Graceful shutdown: stop taking new requests, let in-flight ones finish,
 * drain the export worker's Redis connections, and flush the debounced store
 * write. A container restart mid-punch should cost nothing.
 */
let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} — draining`)
  const failsafe = setTimeout(() => {
    console.error("shutdown took over 10s — exiting anyway")
    process.exit(1)
  }, 10_000)
  failsafe.unref()
  try {
    await app.close()
    await stopExports()
    flush()
    console.log("shutdown clean")
    process.exit(0)
  } catch (error) {
    console.error("shutdown error:", error)
    process.exit(1)
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))

// An unhandled rejection has already skipped its error path; log it loudly
// rather than let Node's default kill the process mid-request.
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason))
