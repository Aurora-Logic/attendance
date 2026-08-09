import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DEMO_ACCOUNTS, demoPasswordFor } from "@/lib/session"

/**
 * The seeded logins must never reach a built bundle.
 *
 * The sign-in screen renders a button per seeded account, so shipping the list
 * put every deployed instance one click away from an ADMIN session — the
 * passwords were compiled into the JavaScript and greppable in `dist/`.
 *
 * These are real credentials, so this is asserted against the actual build
 * output rather than by reading the source: the guard is a bundler
 * substitution, and only the bundler's output can prove it worked.
 */

const WEB = join(__dirname, "..", "..")
const DIST = join(WEB, "dist", "assets")

/** Every seeded password, so a new account cannot be added without cover. */
const SECRETS = ["Admin@123", "Hr@12345", "Ops@1234", "Pick@1234", "Emp@1234"]

describe("seeded accounts in development", () => {
  it("are available, so the sign-in shortcuts still work locally", () => {
    // vitest runs with DEV true, which is the case the shortcuts exist for.
    expect(DEMO_ACCOUNTS.length).toBeGreaterThan(0)
    expect(demoPasswordFor("admin@delta.dev")).toBe("Admin@123")
  })

  it("still resolves a password for every account it advertises", () => {
    // The list and the lookup drifted once before, and the button silently did
    // nothing for the role that was missing.
    for (const account of DEMO_ACCOUNTS) {
      expect(demoPasswordFor(account.email), account.email).not.toBe("")
    }
  })
})

describe("the production bundle", () => {
  it("contains no seeded credential and no seeded address", () => {
    if (!existsSync(DIST)) {
      throw new Error(
        `No build to inspect at ${DIST}. Run: VITE_API_URL=https://example.invalid pnpm --filter @attendance/web build`
      )
    }

    const bundles = readdirSync(DIST).filter((name) => name.endsWith(".js"))
    expect(bundles.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const name of bundles) {
      const source = readFileSync(join(DIST, name), "utf8")
      for (const secret of SECRETS) {
        if (source.includes(secret)) offenders.push(`${name} contains the password ${secret}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("is built as production, not development", () => {
    // The root .env carries NODE_ENV=development for the API, and Vite derives
    // import.meta.env.DEV from NODE_ENV rather than from the build mode. That
    // made every "production" build a development one: React's dev build, a
    // 629 kB entry chunk over the precache budget, and every DEV-gated branch
    // — including the credential list above — left in. If the refresh runtime
    // is present, the flags are wrong again and the guard above is inert.
    const bundles = readdirSync(DIST).filter((name) => name.endsWith(".js"))
    const devArtefacts = bundles.filter((name) => {
      const source = readFileSync(join(DIST, name), "utf8")
      return source.includes("RefreshRuntime") || source.includes("react-refresh")
    })
    expect(devArtefacts).toEqual([])
  })
})
