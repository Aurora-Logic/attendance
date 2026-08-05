import { fileURLToPath } from "node:url"

import { buildServer } from "./server"
import { scheduleNightlyClose } from "./nightly"
import { loadStore, persistOnWrite } from "./persist"

const port = Number(process.env.PORT ?? 3000)
// fileURLToPath, not .pathname — the repo path contains a space and .pathname
// percent-encodes it into a literal "%20" directory.
const dataFile =
  process.env.DATA_FILE ?? fileURLToPath(new URL("../.data/store.json", import.meta.url))

const store = loadStore(dataFile)
const app = buildServer(store)
persistOnWrite(app, store, dataFile)
scheduleNightlyClose(store)

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`api listening on :${port} · data file ${dataFile}`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
