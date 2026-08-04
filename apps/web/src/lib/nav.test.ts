import { describe, expect, it } from "vitest"

import { resolveCrumbs } from "./nav"

describe("resolveCrumbs", () => {
  it("resolves exact nav entries", () => {
    expect(resolveCrumbs("/")).toEqual({ group: "Overview", page: "Dashboard" })
    expect(resolveCrumbs("/purchase-orders")).toEqual({
      group: "Procurement",
      page: "Purchase Orders",
    })
    expect(resolveCrumbs("/vendors")).toEqual({ group: "Procurement", page: "Vendors" })
  })

  it("resolves nested screens to their section by longest prefix", () => {
    expect(resolveCrumbs("/purchase-orders/po2")).toEqual({
      group: "Procurement",
      page: "Purchase Orders",
    })
    expect(resolveCrumbs("/purchase-orders/new")).toEqual({
      group: "Procurement",
      page: "Purchase Orders",
    })
    expect(resolveCrumbs("/employees/e1")).toEqual({ group: "People", page: "Employees" })
  })

  it("only a truly unowned path is Not found", () => {
    expect(resolveCrumbs("/nowhere")).toEqual({ group: null, page: "Not found" })
  })
})
