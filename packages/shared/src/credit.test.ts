import { describe, expect, it } from "vitest"

import {
  creditDecision,
  customerExposure,
  dueDateFor,
  overdueList,
  DEFAULT_CREDIT_TERMS,
  type CreditTerms,
  type OpenDoc,
} from "./credit"

const TODAY = "2026-08-08"

const doc = (over: Partial<OpenDoc> = {}): OpenDoc => ({
  id: "inv1",
  number: "INV-2026-0001",
  customerId: "c1",
  dueDate: "2026-07-01",
  outstandingPaise: 5_000_00,
  ...over,
})

const terms = (over: Partial<CreditTerms> = {}): CreditTerms => ({
  ...DEFAULT_CREDIT_TERMS,
  ...over,
})

describe("dueDateFor", () => {
  it("adds the credit period to the invoice date", () => {
    expect(dueDateFor("2026-08-08", 30)).toBe("2026-09-07")
  })

  it("treats zero days as cash on delivery", () => {
    expect(dueDateFor("2026-08-08", 0)).toBe("2026-08-08")
  })

  it("crosses a month and a year end without arithmetic of its own", () => {
    expect(dueDateFor("2026-12-20", 30)).toBe("2027-01-19")
    expect(dueDateFor("2026-01-31", 29)).toBe("2026-03-01")
  })

  it("hands back an unreadable date rather than inventing one", () => {
    expect(dueDateFor("whenever", 30)).toBe("whenever")
  })
})

describe("customerExposure", () => {
  it("separates what is owed from what is late", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [
        doc({ id: "a", dueDate: "2026-07-01", outstandingPaise: 3_000_00 }),
        doc({ id: "b", dueDate: "2026-09-30", outstandingPaise: 2_000_00 }),
      ],
      todayISO: TODAY,
    })
    expect(exposure.outstandingPaise).toBe(5_000_00)
    expect(exposure.overduePaise).toBe(3_000_00)
  })

  it("reports the oldest debt, which is what a credit call turns on", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ id: "a", dueDate: "2026-05-10" }), doc({ id: "b", dueDate: "2026-08-01" })],
      todayISO: TODAY,
    })
    expect(exposure.oldestOverdueDays).toBe(90)
    expect(exposure.overdue[0].id).toBe("a")
    expect(exposure.overdue[0].bucket).toBe("61-90")
  })

  it("drops settled documents rather than listing them as zero", () => {
    // A list padded with settled invoices is a list nobody reads.
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ outstandingPaise: 0 })],
      todayISO: TODAY,
    })
    expect(exposure.overdue).toEqual([])
    expect(exposure.outstandingPaise).toBe(0)
  })

  it("ignores another customer's paper", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ customerId: "c2" })],
      todayISO: TODAY,
    })
    expect(exposure.outstandingPaise).toBe(0)
  })

  it("does not treat a document due today as late", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: TODAY })],
      todayISO: TODAY,
    })
    expect(exposure.overduePaise).toBe(0)
  })
})

describe("creditDecision", () => {
  const clean = customerExposure({ customerId: "c1", docs: [], todayISO: TODAY })

  it("lets a customer within terms through", () => {
    expect(creditDecision({ exposure: clean, terms: terms() }).verdict).toBe("OK")
  })

  it("holds an account past the grace period", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-06-01" })],
      todayISO: TODAY,
    })
    const decision = creditDecision({ exposure, terms: terms({ overdueGraceDays: 7 }) })
    expect(decision.verdict).toBe("HOLD")
    expect(decision.reason).toMatch(/68 days past due/)
  })

  it("warns rather than holds while still inside the grace period", () => {
    // Being refused without notice on a Friday afternoon is how a counter loses
    // a customer over three days of lateness.
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-08-05" })],
      todayISO: TODAY,
    })
    expect(creditDecision({ exposure, terms: terms({ overdueGraceDays: 7 }) }).verdict).toBe("WARN")
  })

  it("holds an order that would cross the credit limit", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-12-01", outstandingPaise: 90_000_00 })],
      todayISO: TODAY,
    })
    const decision = creditDecision({
      exposure,
      terms: terms({ creditLimitPaise: 100_000_00 }),
      orderValuePaise: 20_000_00,
    })
    expect(decision.verdict).toBe("HOLD")
    expect(decision.reason).toMatch(/past its credit limit/)
    expect(decision.headroomPaise).toBe(-10_000_00)
  })

  it("keeps lateness and the limit apart — they need different conversations", () => {
    // Within the limit but sixty days late is a collection problem; on time but
    // at the ceiling is a limit problem.
    const late = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-06-01", outstandingPaise: 1_000_00 })],
      todayISO: TODAY,
    })
    const decision = creditDecision({ exposure: late, terms: terms({ creditLimitPaise: 100_000_00 }) })
    expect(decision.verdict).toBe("HOLD")
    expect(decision.reason).toMatch(/past due/)
    expect(decision.reason).not.toMatch(/limit/)
  })

  it("warns as the limit comes close, before the order that crosses it", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-12-01", outstandingPaise: 95_000_00 })],
      todayISO: TODAY,
    })
    const decision = creditDecision({ exposure, terms: terms({ creditLimitPaise: 100_000_00 }) })
    expect(decision.verdict).toBe("WARN")
    expect(decision.reason).toBe("Close to the credit limit.")
  })

  it("enforces no limit when none is set", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-12-01", outstandingPaise: 900_000_00 })],
      todayISO: TODAY,
    })
    const decision = creditDecision({ exposure, terms: terms({ creditLimitPaise: 0 }) })
    expect(decision.verdict).toBe("OK")
    expect(decision.headroomPaise).toBeNull()
  })

  it("says whether an approver may release it", () => {
    const exposure = customerExposure({
      customerId: "c1",
      docs: [doc({ dueDate: "2026-06-01" })],
      todayISO: TODAY,
    })
    expect(creditDecision({ exposure, terms: terms({ allowOverride: false }) }).overridable).toBe(false)
    expect(creditDecision({ exposure, terms: terms({ allowOverride: true }) }).overridable).toBe(true)
  })
})

describe("overdueList", () => {
  const customers = [
    { id: "c1", name: "Kumar & Sons" },
    { id: "c2", name: "Steel Supplies" },
    { id: "c3", name: "Paid Up Traders" },
  ]

  it("puts the oldest debt first, not the largest", () => {
    // A small invoice ninety days old is closer to being written off than a
    // large one that fell due last week.
    const rows = overdueList({
      docs: [
        doc({ id: "a", customerId: "c1", dueDate: "2026-05-01", outstandingPaise: 1_000_00 }),
        doc({ id: "b", customerId: "c2", dueDate: "2026-08-01", outstandingPaise: 500_000_00 }),
      ],
      customers,
      todayISO: TODAY,
    })
    expect(rows.map((row) => row.customerName)).toEqual(["Kumar & Sons", "Steel Supplies"])
  })

  it("leaves out anyone who owes nothing overdue", () => {
    const rows = overdueList({
      docs: [doc({ customerId: "c3", dueDate: "2026-12-01" })],
      customers,
      todayISO: TODAY,
    })
    expect(rows).toEqual([])
  })

  it("names the oldest document, which is what a call opens with", () => {
    const rows = overdueList({
      docs: [
        doc({ id: "a", number: "INV-0009", customerId: "c1", dueDate: "2026-05-01" }),
        doc({ id: "b", number: "INV-0044", customerId: "c1", dueDate: "2026-07-20" }),
      ],
      customers,
      todayISO: TODAY,
    })
    expect(rows[0].oldestDocNumber).toBe("INV-0009")
    expect(rows[0].docCount).toBe(2)
    expect(rows[0].overduePaise).toBe(10_000_00)
  })

  it("skips amounts too small to be worth a phone call", () => {
    const rows = overdueList({
      docs: [doc({ customerId: "c1", outstandingPaise: 40_00 })],
      customers,
      todayISO: TODAY,
      minimumPaise: 100_00,
    })
    expect(rows).toEqual([])
  })
})
