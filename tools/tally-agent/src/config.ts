/**
 * What the connector needs to know, and how it complains when it doesn't.
 *
 * The person setting this up is an accountant or an IT contractor at the
 * customer's office, not a developer. Every failure here has to say what is
 * wrong and where to fix it, because nobody is going to read a stack trace on
 * a shop-floor PC.
 */

export interface AgentConfig {
  /** Where this API lives, e.g. https://attendance.example.com */
  apiUrl: string
  /** Shared secret; must match TALLY_AGENT_SECRET on the server. */
  agentSecret: string
  /** Company name exactly as Tally shows it. */
  company: string
  /** Tally's XML gateway. Local by default — it is not safe to expose. */
  tallyUrl: string
  /** Seconds between sync passes. */
  pollSeconds: number
  /** Where the outbox and watermarks live between runs. */
  stateDir: string
  /** Write back to Tally, or read only. */
  writeBack: boolean
}

export class ConfigError extends Error {}

const DEFAULTS = {
  tallyUrl: "http://localhost:9000",
  pollSeconds: 60,
  writeBack: true,
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Merge a config file with environment variables. The environment wins, so a
 * secret can be kept out of a file that gets copied around or emailed.
 */
export function loadConfig(input: {
  file?: Record<string, unknown>
  env?: Record<string, string | undefined>
  defaultStateDir: string
}): AgentConfig {
  const file = input.file ?? {}
  const env = input.env ?? {}
  const problems: string[] = []

  const apiUrl = asString(env.TALLY_AGENT_API_URL) ?? asString(file.apiUrl)
  const agentSecret = asString(env.TALLY_AGENT_SECRET) ?? asString(file.agentSecret)
  const company = asString(env.TALLY_AGENT_COMPANY) ?? asString(file.company)

  /**
   * The template's own placeholder values are all syntactically valid, so
   * without this the connector starts happily against `example.com` and reports
   * itself as running. Somebody would install it, see no errors, and only find
   * out at month end that nothing had ever synced.
   */
  const untouched: string[] = []
  if (apiUrl === SAMPLE_CONFIG.apiUrl) untouched.push("apiUrl")
  if (agentSecret === SAMPLE_CONFIG.agentSecret) untouched.push("agentSecret")
  if (company === SAMPLE_CONFIG.company) untouched.push("company")
  if (untouched.length > 0) {
    throw new ConfigError(
      `These are still set to the example values in tally-agent.json: ${untouched.join(", ")}.\n` +
        "Replace them with your own before starting the connector."
    )
  }

  if (!apiUrl) problems.push('apiUrl — the address of the attendance server, e.g. "https://attendance.example.com"')
  else if (!/^https?:\/\//i.test(apiUrl)) problems.push(`apiUrl — must start with http:// or https://, got "${apiUrl}"`)
  else if (/^http:\/\//i.test(apiUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(apiUrl))
    problems.push(
      `apiUrl — "${apiUrl}" is plain HTTP over a network. The agent secret would travel in clear text; use https://`
    )

  if (!agentSecret) problems.push("agentSecret — must match TALLY_AGENT_SECRET on the server")
  if (!company) problems.push('company — the company name exactly as Tally shows it, e.g. "Delta Traders"')

  const rawPoll = env.TALLY_AGENT_POLL_SECONDS ?? file.pollSeconds
  let pollSeconds = DEFAULTS.pollSeconds
  if (rawPoll !== undefined && rawPoll !== "") {
    const parsed = Number(rawPoll)
    if (!Number.isFinite(parsed) || parsed < 10) {
      // Below ten seconds the agent spends its life re-reading masters that did
      // not change, and Tally is single-threaded — it would slow down the
      // people actually using it.
      problems.push(`pollSeconds — must be a number of at least 10, got "${String(rawPoll)}"`)
    } else {
      pollSeconds = Math.floor(parsed)
    }
  }

  const tallyUrl = asString(env.TALLY_AGENT_TALLY_URL) ?? asString(file.tallyUrl) ?? DEFAULTS.tallyUrl
  const stateDir = asString(env.TALLY_AGENT_STATE_DIR) ?? asString(file.stateDir) ?? input.defaultStateDir
  const writeBackRaw = env.TALLY_AGENT_WRITE_BACK ?? file.writeBack
  const writeBack =
    writeBackRaw === undefined || writeBackRaw === ""
      ? DEFAULTS.writeBack
      : writeBackRaw === true || writeBackRaw === "true" || writeBackRaw === "1"

  if (problems.length > 0) {
    throw new ConfigError(
      ["The connector cannot start. Fix these in tally-agent.json:", ...problems.map((line) => `  • ${line}`)].join(
        "\n"
      )
    )
  }

  return {
    apiUrl: apiUrl!.replace(/\/+$/, ""),
    agentSecret: agentSecret!,
    company: company!,
    tallyUrl: tallyUrl.replace(/\/+$/, ""),
    pollSeconds,
    stateDir,
    writeBack,
  }
}

/** What we write next to the executable when there is no config yet. */
export const SAMPLE_CONFIG = {
  apiUrl: "https://REPLACE-WITH-YOUR-SERVER-ADDRESS",
  agentSecret: "paste the value of TALLY_AGENT_SECRET from the server here",
  company: "Your Company Name As Shown In Tally",
  tallyUrl: "http://localhost:9000",
  pollSeconds: 60,
  writeBack: true,
}
