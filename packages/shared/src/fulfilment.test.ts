import { describe, expect, it } from "vitest"

import type { Challan, SalesOrder } from "./sales"
import {
  fulfilmentView,
  lrCopyStatus,
  packedQty,
  pickableQty,
  podOverdue,
  validateConsignment,
  validatePack,
  validatePick,
  validatePod,
  type Consignment,
  type Pack,
  type PickList,
  type ProofOfDelivery,
} from "./fulfilment"

const so: Pick<SalesOrder, "id" | "lines" | "status"> = {
  id: "so1",
  status: "OPEN",
  lines: [
    { id: "l1", itemId: "i1", qty: 100, unitPricePaise: 1200, gstRatePct: 18, discountPct: 0 },
    { id: "l2", itemId: "i2", qty: 50, unitPricePaise: 800, gstRatePct: 18, discountPct: 0 },
  ],
}

const pick = (over: Partial<PickList> = {}): PickList => ({
  id: "pk1",
  number: "PL-2026-0001",
  soId: "so1",
  assignedTo: "e4",
  status: "PICKING",
  createdAt: "2026-08-08T09:00:00.000Z",
  startedAt: "2026-08-08T09:05:00.000Z",
  completedAt: null,
  lines: [
    { soLineId: "l1", itemId: "i1", requestedQty: 100, pickedQty: 100, location: "A-12", shortReason: "" },
  ],
  notes: "",
  ...over,
})

const consignment = (over: Partial<Consignment> = {}): Consignment => ({
  id: "cn1",
  number: "DSP-2026-0001",
  soId: "so1",
  challanId: "ch1",
  packId: "pa1",
  dispatchedAt: "2026-08-08T16:40:00.000Z",
  dispatchedBy: "e3",
  transporterName: "VRL Logistics",
  ownVehicle: false,
  lrNumber: "44821",
  lrDate: "2026-08-08",
  vehicleNo: "MH-12-AB-1234",
  driverName: "Ramesh",
  driverPhone: "+91 98200 00000",
  freightPaise: 250_000,
  freightTerms: "PAID",
  ewayBillNo: "",
  packageCount: 4,
  weightKg: 120,
  lrAttachments: [],
  remarks: "",
  ...over,
})

const pod = (over: Partial<ProofOfDelivery> = {}): ProofOfDelivery => ({
  id: "pod1",
  consignmentId: "cn1",
  deliveredAt: "2026-08-10T11:00:00.000Z",
  receivedBy: "Sunita Shah",
  receiverPhone: "",
  condition: "OK",
  shortages: [],
  attachments: [],
  recordedBy: "e3",
  remarks: "",
  ...over,
})

describe("pickableQty", () => {
  it("is the ordered quantity when nothing has happened yet", () => {
    expect(pickableQty(so, "l1", [], [])).toBe(100)
  })

  it("takes off what has already been dispatched", () => {
    const challan: Challan = {
      id: "ch1",
      number: "CH-1",
      soId: "so1",
      dispatchDate: "2026-08-07",
      vehicleNo: "",
      remarks: "",
      recordedBy: "e3",
      lines: [{ soLineId: "l1", qty: 40 }],
    }
    expect(pickableQty(so, "l1", [challan], [])).toBe(60)
  })

  it("takes off what another open list has already claimed", () => {
    // Otherwise two pickers are sent for the same carton and the second finds
    // an empty rack — a shortage the system caused.
    expect(pickableQty(so, "l1", [], [pick({ lines: [{ ...pick().lines[0], requestedQty: 70, pickedQty: 0 }] })])).toBe(
      30
    )
  })

  it("does not count a list against itself when that list is being edited", () => {
    const existing = pick()
    expect(pickableQty(so, "l1", [], [existing], existing.id)).toBe(100)
  })

  it("ignores a cancelled list, which holds nothing", () => {
    expect(pickableQty(so, "l1", [], [pick({ status: "CANCELLED" })])).toBe(100)
  })

  it("never goes negative when a line is over-dispatched", () => {
    const challan: Challan = {
      id: "ch1",
      number: "CH-1",
      soId: "so1",
      dispatchDate: "2026-08-07",
      vehicleNo: "",
      remarks: "",
      recordedBy: "e3",
      lines: [{ soLineId: "l1", qty: 140 }],
    }
    expect(pickableQty(so, "l1", [challan], [])).toBe(0)
  })

  it("returns nothing for a line that is not on the order", () => {
    expect(pickableQty(so, "ghost", [], [])).toBe(0)
  })
})

describe("validatePick", () => {
  it("passes a list within what is available", () => {
    expect(validatePick({ so, pick: pick(), challans: [], otherPicks: [] })).toEqual([])
  })

  it("refuses a request larger than what is left", () => {
    const other = pick({
      id: "pk0",
      status: "PENDING",
      lines: [{ ...pick().lines[0], requestedQty: 80, pickedQty: 0 }],
    })
    const issues = validatePick({ so, pick: pick(), challans: [], otherPicks: [other] })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Only 20 left/)
  })

  it("refuses picking more than was asked for", () => {
    // Over-picking is how stock quietly leaves the building.
    const issues = validatePick({
      so,
      pick: pick({ lines: [{ ...pick().lines[0], requestedQty: 100, pickedQty: 130 }] }),
      challans: [],
      otherPicks: [],
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Picked 130 against a request for 100/)
  })

  it("insists a short line says why", () => {
    const issues = validatePick({
      so,
      pick: pick({ status: "SHORT", lines: [{ ...pick().lines[0], pickedQty: 60 }] }),
      challans: [],
      otherPicks: [],
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Say why this line is short/)
  })

  it("does not nag for a reason while the picker is still walking", () => {
    expect(
      validatePick({
        so,
        pick: pick({ status: "PICKING", lines: [{ ...pick().lines[0], pickedQty: 20 }] }),
        challans: [],
        otherPicks: [],
      })
    ).toEqual([])
  })

  it("refuses to call a short list complete", () => {
    const issues = validatePick({
      so,
      pick: pick({
        status: "PICKED",
        lines: [{ ...pick().lines[0], pickedQty: 60, shortReason: "stock" }],
      }),
      challans: [],
      otherPicks: [],
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Mark the list SHORT/)
  })

  it("refuses a line that is not on the order, and a list on the wrong order", () => {
    const issues = validatePick({
      so,
      pick: pick({ soId: "so9", lines: [{ ...pick().lines[0], soLineId: "ghost" }] }),
      challans: [],
      otherPicks: [],
    })
    const text = issues.map((issue) => issue.message).join(" ")
    expect(text).toMatch(/belongs to another order/)
    expect(text).toMatch(/not on this order/)
  })

  it("reports every problem at once rather than one per submit", () => {
    const issues = validatePick({
      so,
      pick: pick({
        assignedTo: null,
        status: "SHORT",
        lines: [
          { soLineId: "l1", itemId: "i1", requestedQty: 100, pickedQty: 60, location: "", shortReason: "" },
          { soLineId: "ghost", itemId: "i9", requestedQty: 5, pickedQty: 5, location: "", shortReason: "" },
        ],
      }),
      challans: [],
      otherPicks: [],
    })
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
})

describe("packing", () => {
  const pack = (over: Partial<Pack> = {}): Pack => ({
    id: "pa1",
    number: "PK-2026-0001",
    pickListId: "pk1",
    soId: "so1",
    packedBy: "e4",
    packedAt: "2026-08-08T12:00:00.000Z",
    packages: [
      { sequence: 1, description: "Carton", weightKg: 30, contents: [{ soLineId: "l1", qty: 60 }] },
      { sequence: 2, description: "Carton", weightKg: 30, contents: [{ soLineId: "l1", qty: 40 }] },
    ],
    notes: "",
    ...over,
  })

  it("totals a line across every carton", () => {
    expect(packedQty(pack(), "l1")).toBe(100)
  })

  it("accepts a pack that matches the pick", () => {
    expect(validatePack({ pack: pack(), pick: pick({ status: "PICKED" }) })).toEqual([])
  })

  it("refuses to pack more than was picked", () => {
    // The seal on the carton is the last moment anybody counts.
    const issues = validatePack({
      pack: pack(),
      pick: pick({ status: "SHORT", lines: [{ ...pick().lines[0], pickedQty: 80, shortReason: "stock" }] }),
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Packed 100 but only 80 was picked/)
  })

  it("refuses to pack before picking is finished", () => {
    const issues = validatePack({ pack: pack(), pick: pick({ status: "PICKING" }) })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/Finish picking before packing/)
  })

  it("refuses a cancelled pick list", () => {
    const issues = validatePack({ pack: pack(), pick: pick({ status: "CANCELLED" }) })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/was cancelled/)
  })

  it("notices a line that was never picked", () => {
    const issues = validatePack({
      pack: pack({
        packages: [{ sequence: 1, description: "", weightKg: 1, contents: [{ soLineId: "l2", qty: 5 }] }],
      }),
      pick: pick({ status: "PICKED" }),
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/not on the pick list/)
  })

  it("notices two cartons numbered the same", () => {
    const issues = validatePack({
      pack: pack({
        packages: [
          { sequence: 1, description: "", weightKg: 1, contents: [{ soLineId: "l1", qty: 10 }] },
          { sequence: 1, description: "", weightKg: 1, contents: [{ soLineId: "l1", qty: 10 }] },
        ],
      }),
      pick: pick({ status: "PICKED" }),
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/same number/)
  })
})

describe("the LR and its three copies", () => {
  it("counts each copy separately, because each one goes somewhere else", () => {
    // Filing "the LR" as a single scan is how the consignee copy goes missing
    // and a claim against the transporter fails months later.
    const status = lrCopyStatus(
      consignment({
        lrAttachments: [
          { copy: "CONSIGNOR", url: "a.pdf", uploadedBy: "e3", uploadedAt: "2026-08-08T17:00:00.000Z" },
        ],
      })
    )
    expect(status.held).toEqual(["CONSIGNOR"])
    expect(status.missing).toEqual(["CONSIGNEE", "TRANSPORTER"])
    expect(status.complete).toBe(false)
  })

  it("is complete only with all three", () => {
    const status = lrCopyStatus(
      consignment({
        lrAttachments: (["CONSIGNOR", "CONSIGNEE", "TRANSPORTER"] as const).map((copy) => ({
          copy,
          url: `${copy}.pdf`,
          uploadedBy: "e3",
          uploadedAt: "2026-08-08T17:00:00.000Z",
        })),
      })
    )
    expect(status.complete).toBe(true)
  })

  it("asks for nothing when the goods went on our own lorry", () => {
    expect(lrCopyStatus(consignment({ ownVehicle: true })).complete).toBe(true)
  })
})

describe("validateConsignment", () => {
  it("accepts a properly documented dispatch", () => {
    expect(validateConsignment({ consignment: consignment() })).toEqual([])
  })

  it("insists on an LR number for a hired lorry", () => {
    // Without one, a claim against the transporter has nothing to reference.
    const issues = validateConsignment({ consignment: consignment({ lrNumber: "  " }) })
    expect(issues.map((issue) => issue.field)).toContain("lrNumber")
  })

  it("relaxes the LR rules for our own vehicle", () => {
    expect(
      validateConsignment({
        consignment: consignment({ ownVehicle: true, transporterName: "", lrNumber: "", lrDate: null }),
      })
    ).toEqual([])
  })

  it("refuses an LR dated after the lorry left", () => {
    const issues = validateConsignment({
      consignment: consignment({ lrDate: "2026-08-20", dispatchedAt: "2026-08-08T16:40:00.000Z" }),
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/cannot be dated after the dispatch/)
  })

  it("refuses to-pay freight with no amount on it", () => {
    const issues = validateConsignment({
      consignment: consignment({ freightTerms: "TO_PAY", freightPaise: 0 }),
    })
    expect(issues.map((issue) => issue.field)).toContain("freightPaise")
  })

  it("can require that only packed goods are dispatched", () => {
    expect(validateConsignment({ consignment: consignment({ packId: null }), requirePack: true })).toHaveLength(1)
    expect(validateConsignment({ consignment: consignment({ packId: null }) })).toEqual([])
  })

  it("always wants the vehicle number", () => {
    expect(
      validateConsignment({ consignment: consignment({ ownVehicle: true, vehicleNo: "" }) }).map((i) => i.field)
    ).toContain("vehicleNo")
  })
})

describe("validatePod", () => {
  it("accepts a clean signed delivery", () => {
    expect(validatePod({ pod: pod(), consignment: consignment() })).toEqual([])
  })

  it("refuses a delivery dated before the lorry left", () => {
    // Backdating hides a delay and corrupts every transit-time figure.
    const issues = validatePod({
      pod: pod({ deliveredAt: "2026-08-01T11:00:00.000Z" }),
      consignment: consignment(),
    })
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/cannot predate the dispatch/)
  })

  it("insists a shortage is a quantity, not a remark", () => {
    const issues = validatePod({
      pod: pod({ condition: "SHORT", remarks: "some cartons missing" }),
      consignment: consignment(),
    })
    expect(issues.map((issue) => issue.field)).toContain("shortages")
  })

  it("refuses to call a delivery clean when shortages are recorded", () => {
    const issues = validatePod({
      pod: pod({ condition: "OK", shortages: [{ soLineId: "l1", qty: 5, note: "" }] }),
      consignment: consignment(),
    })
    expect(issues.map((issue) => issue.field)).toContain("condition")
  })

  it("insists a refusal is explained", () => {
    const issues = validatePod({ pod: pod({ condition: "REFUSED" }), consignment: consignment() })
    expect(issues.map((issue) => issue.field)).toContain("remarks")
  })

  it("refuses a proof filed against the wrong dispatch", () => {
    const issues = validatePod({ pod: pod({ consignmentId: "cn9" }), consignment: consignment() })
    expect(issues.map((issue) => issue.field)).toContain("consignmentId")
  })
})

describe("fulfilmentView", () => {
  const base = { so, challans: [], picks: [], packs: [], consignments: [], pods: [] }
  const fullChallan: Challan = {
    id: "ch1",
    number: "CH-1",
    soId: "so1",
    dispatchDate: "2026-08-08",
    vehicleNo: "",
    remarks: "",
    recordedBy: "e3",
    lines: [
      { soLineId: "l1", qty: 100 },
      { soLineId: "l2", qty: 50 },
    ],
  }

  it("starts at ordered", () => {
    expect(fulfilmentView(base).stage).toBe("ORDERED")
  })

  const packed: Pack = {
    id: "pa1",
    number: "PK-2026-0001",
    pickListId: "pk1",
    soId: "so1",
    packedBy: "e4",
    packedAt: "2026-08-08T12:00:00.000Z",
    packages: [{ sequence: 1, description: "Carton", weightKg: 30, contents: [{ soLineId: "l1", qty: 100 }] }],
    notes: "",
  }

  it("moves through picking, packed and dispatched", () => {
    expect(fulfilmentView({ ...base, picks: [pick()] }).stage).toBe("PICKING")
    expect(fulfilmentView({ ...base, picks: [pick()], packs: [packed] }).stage).toBe("PACKED")
    expect(fulfilmentView({ ...base, consignments: [consignment()] }).stage).toBe("DISPATCHED")
  })

  it("says picked-not-packed rather than just 'with the picker'", () => {
    expect(fulfilmentView({ ...base, picks: [pick({ status: "PICKED" })] }).summary).toBe(
      "Picked, not yet packed."
    )
  })

  it("reaches delivered only when everything went out and was signed for", () => {
    const partly = fulfilmentView({ ...base, consignments: [consignment()], pods: [pod()] })
    // Signed for, but the order is not fully dispatched — not done.
    expect(partly.stage).toBe("DISPATCHED")

    const done = fulfilmentView({
      ...base,
      challans: [fullChallan],
      consignments: [consignment()],
      pods: [pod()],
    })
    expect(done.stage).toBe("DELIVERED")
  })

  it("an exception outranks everything else", () => {
    const view = fulfilmentView({
      ...base,
      challans: [fullChallan],
      consignments: [consignment()],
      pods: [pod({ condition: "DAMAGED", shortages: [{ soLineId: "l1", qty: 3, note: "crushed" }] })],
    })
    expect(view.stage).toBe("EXCEPTION")
  })

  it("names the dispatches still waiting for a signature and an LR copy", () => {
    const view = fulfilmentView({ ...base, consignments: [consignment()] })
    expect(view.awaitingPod).toEqual(["cn1"])
    expect(view.missingLrCopies).toEqual(["cn1"])
  })

  it("ignores documents belonging to another order", () => {
    const view = fulfilmentView({ ...base, consignments: [consignment({ soId: "so9" })] })
    expect(view.stage).toBe("ORDERED")
  })
})

describe("podOverdue", () => {
  const asOf = "2026-08-20T09:00:00.000Z"

  it("lists dispatches nobody has signed for, oldest first", () => {
    // After a few weeks the transporter is not liable and the customer does
    // not remember. This is the list somebody chases every morning.
    const rows = podOverdue({
      consignments: [
        consignment({ id: "cn1", number: "DSP-1", dispatchedAt: "2026-08-01T10:00:00.000Z" }),
        consignment({ id: "cn2", number: "DSP-2", dispatchedAt: "2026-08-10T10:00:00.000Z" }),
      ],
      pods: [],
      asOfISO: asOf,
      graceDays: 3,
    })
    expect(rows.map((row) => row.number)).toEqual(["DSP-1", "DSP-2"])
    expect(rows[0].daysOut).toBe(18)
  })

  it("leaves out anything already signed for", () => {
    const rows = podOverdue({
      consignments: [consignment({ id: "cn1", dispatchedAt: "2026-08-01T10:00:00.000Z" })],
      pods: [pod({ consignmentId: "cn1" })],
      asOfISO: asOf,
      graceDays: 3,
    })
    expect(rows).toEqual([])
  })

  it("respects the grace period, so today's lorry is not already a problem", () => {
    const rows = podOverdue({
      consignments: [consignment({ dispatchedAt: "2026-08-19T10:00:00.000Z" })],
      pods: [],
      asOfISO: asOf,
      graceDays: 3,
    })
    expect(rows).toEqual([])
  })

  it("returns nothing rather than nonsense when the date is unreadable", () => {
    expect(
      podOverdue({ consignments: [consignment()], pods: [], asOfISO: "not-a-date", graceDays: 3 })
    ).toEqual([])
  })
})
