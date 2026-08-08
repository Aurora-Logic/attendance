import type { TallyStatus } from "@/lib/queries"

/**
 * Turning connector telemetry into something worth acting on.
 *
 * Two faults look identical from a distance and need opposite responses: the
 * connector being down (go and look at that PC) and Tally being closed (wait
 * until morning). Keeping them apart is the entire job of this file.
 */

/** "4 minutes ago" beats an ISO string for a number somebody is judging freshness by. */
export function sinceLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes === 1) return "1 minute ago"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return "1 hour ago"
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? "1 day ago" : `${days} days ago`
}

export interface ConnectorReading {
  tone: "ok" | "warn" | "bad"
  headline: string
  detail: string
}

/**
 * One sentence for the whole connector, written as the decision the reader has
 * to make rather than as a status code.
 */
export function readConnector(agent: TallyStatus["agent"]): ConnectorReading {
  if (agent.state === "never")
    return {
      tone: "warn",
      headline: "Not connected yet",
      detail: "No connector has ever reported in. Follow the setup guide on the Tally PC.",
    }

  if (agent.state === "stale")
    return {
      tone: "bad",
      headline: `Connector silent for ${sinceLabel(agent.staleForMs)}`,
      detail:
        "Nothing has synced since then. The PC may be switched off, or the connector service has stopped.",
    }

  if (agent.tallyReachable === false)
    return {
      tone: "warn",
      headline: "Running, but Tally is not answering",
      detail:
        agent.queuedRecords > 0
          ? `${agent.queuedRecords} change(s) are held safely on that PC. Normal outside working hours — open Tally and they will go through.`
          : "Normal outside working hours. During the day, open Tally and load the company.",
    }

  return {
    tone: "ok",
    headline: "Connected",
    detail: `Last heard from ${sinceLabel(agent.staleForMs)}${agent.company ? ` · ${agent.company}` : ""}.`,
  }
}
