/**
 * Logging for a machine nobody is watching.
 *
 * This runs as a Windows service on a PC in an accounts room. When something
 * goes wrong, the person who reads this file is not a developer, so every line
 * is timestamped, plain, and says what to do rather than what threw.
 */

function stamp(): string {
  // Local time, because whoever reads the log is standing next to the machine.
  return new Date().toLocaleString("en-IN", { hour12: false })
}

export const log = {
  info: (message: string) => console.log(`${stamp()}  ${message}`),
  warn: (message: string) => console.log(`${stamp()}  WARNING  ${message}`),
  error: (message: string) => console.error(`${stamp()}  ERROR    ${message}`),
}

/**
 * Turn a fetch failure into something actionable.
 *
 * Node's network errors say "fetch failed" and hide the cause two levels down,
 * which tells the person on site nothing at all.
 */
export function describeNetworkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (error as { code?: string })?.code
  const name = (error as { name?: string })?.name

  if (name === "AbortError") return "The request timed out. The server may be slow or the line may be down."
  switch (code) {
    case "ECONNREFUSED":
      return "Nothing is listening at that address. If this is Tally, it is closed or its XML port is off; if it is the server, check the address."
    case "ENOTFOUND":
      return "That address could not be resolved. Check the spelling in tally-agent.json and this machine's internet connection."
    case "ETIMEDOUT":
      return "The connection timed out. Check the internet connection, and whether a firewall is blocking outbound HTTPS."
    case "ECONNRESET":
      return "The connection was cut mid-request. Usually the line dropped; it will be retried."
    case "CERT_HAS_EXPIRED":
      return "The server's HTTPS certificate has expired."
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "The server's HTTPS certificate could not be verified. If the server is on the local network with a self-signed certificate, it needs a real one."
    default:
      return (error as Error)?.message ?? String(error)
  }
}
