import { describe, expect, it } from "vitest"

import { ConfigError, loadConfig, SAMPLE_CONFIG } from "./config"

const base = {
  apiUrl: "https://ops.delta-traders.example",
  agentSecret: "a".repeat(48),
  company: "Delta Traders",
}
const defaultStateDir = "/var/agent"

describe("loadConfig", () => {
  it("accepts a filled-in file and applies the defaults", () => {
    const config = loadConfig({ file: base, defaultStateDir })
    expect(config).toMatchObject({
      tallyUrl: "http://localhost:9000",
      pollSeconds: 60,
      writeBack: true,
      stateDir: defaultStateDir,
    })
  })

  it("lets the environment override the file, so the secret need not live in it", () => {
    const config = loadConfig({
      file: base,
      env: { TALLY_AGENT_SECRET: "b".repeat(48) },
      defaultStateDir,
    })
    expect(config.agentSecret).toBe("b".repeat(48))
  })

  it("names every missing field at once instead of one per restart", () => {
    // Someone on a shop floor should not have to run this five times to learn
    // five things.
    try {
      loadConfig({ file: {}, defaultStateDir })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const message = (error as Error).message
      expect(message).toContain("apiUrl")
      expect(message).toContain("agentSecret")
      expect(message).toContain("company")
    }
  })

  it("refuses plain HTTP to a remote server — the secret would travel in clear", () => {
    expect(() => loadConfig({ file: { ...base, apiUrl: "http://attendance.example.com" }, defaultStateDir })).toThrow(
      /clear text/
    )
  })

  it("still allows plain HTTP to localhost, which is how it is developed", () => {
    expect(loadConfig({ file: { ...base, apiUrl: "http://localhost:3000" }, defaultStateDir }).apiUrl).toBe(
      "http://localhost:3000"
    )
  })

  it("refuses a poll interval that would hammer a single-threaded Tally", () => {
    expect(() => loadConfig({ file: { ...base, pollSeconds: 2 }, defaultStateDir })).toThrow(/at least 10/)
    expect(() => loadConfig({ file: { ...base, pollSeconds: "soon" }, defaultStateDir })).toThrow(/at least 10/)
  })

  it("trims the trailing slash so URLs do not end up doubled", () => {
    const config = loadConfig({
      file: { ...base, apiUrl: "https://ops.delta-traders.example/", tallyUrl: "http://localhost:9000/" },
      defaultStateDir,
    })
    expect(config.apiUrl).toBe("https://ops.delta-traders.example")
    expect(config.tallyUrl).toBe("http://localhost:9000")
  })

  it("treats a blank string as absent rather than as a value", () => {
    expect(() => loadConfig({ file: { ...base, company: "   " }, defaultStateDir })).toThrow(/company/)
  })

  it("refuses to start on the template it wrote itself", () => {
    // Every placeholder is syntactically valid, so without this check the
    // connector runs against example.com, reports no errors, and nobody finds
    // out until month end that nothing ever synced.
    try {
      loadConfig({ file: { ...SAMPLE_CONFIG }, defaultStateDir })
      expect.unreachable("should have refused the untouched template")
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain("example values")
      expect(message).toContain("apiUrl")
      expect(message).toContain("agentSecret")
      expect(message).toContain("company")
    }
  })

  it("names only the placeholders still left in place", () => {
    expect(() =>
      loadConfig({ file: { ...SAMPLE_CONFIG, apiUrl: "https://real.example.net" }, defaultStateDir })
    ).toThrow(/agentSecret, company/)
  })

  it("can be put in read-only mode", () => {
    expect(loadConfig({ file: { ...base, writeBack: false }, defaultStateDir }).writeBack).toBe(false)
    expect(
      loadConfig({ file: base, env: { TALLY_AGENT_WRITE_BACK: "false" }, defaultStateDir }).writeBack
    ).toBe(false)
  })
})
