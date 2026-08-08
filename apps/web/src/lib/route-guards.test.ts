import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { NAV_GROUPS } from "./nav"

/**
 * Every nav entry that declares a permission must have a route guarded by the
 * same permission. The two were allowed to drift once already: the sidebar hid
 * fifteen commercial screens from an employee while every one of them stayed
 * reachable by URL, including the two that create and submit real purchase
 * orders and estimates.
 *
 * Asserted against the router source rather than a rendered tree, so adding a
 * route without a guard fails here rather than in a browser nobody ran.
 */
const appSource = readFileSync(
  fileURLToPath(new URL("../App.tsx", import.meta.url)),
  "utf8"
)

/** The route element block for a given path, if the router declares one. */
function routeBlock(path: string): string | null {
  const escaped = path.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")
  const match = appSource.match(
    new RegExp(`<Route\\s+path="${escaped}"[\\s\\S]*?(?=<Route\\s|</Route>)`)
  )
  return match ? match[0] : null
}

describe("nav permissions and route guards agree", () => {
  const guarded = NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => item.permission && item.url.startsWith("/") && item.url !== "/")
    .map((item) => ({ url: item.url, permission: item.permission! }))

  it("covers a meaningful number of screens", () => {
    expect(guarded.length).toBeGreaterThan(15)
  })

  it.each(guarded)("$url is guarded by $permission", ({ url, permission }) => {
    const block = routeBlock(url.slice(1))
    // A nav entry pointing at a route the router does not declare is itself a
    // problem worth surfacing.
    expect(block, `no route declared for ${url}`).not.toBeNull()
    expect(
      block!.includes(`permission="${permission}"`),
      `${url} is reachable without ${permission}`
    ).toBe(true)
  })
})
