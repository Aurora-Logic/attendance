import { main } from "./agent"
import { log } from "./log"

/**
 * The entry point, kept separate from the agent so importing the agent in a
 * test does not start a sync loop against a real Tally.
 */
void main().catch((error: unknown) => {
  log.error(`The connector could not start: ${(error as Error).stack ?? String(error)}`)
  process.exitCode = 1
})
