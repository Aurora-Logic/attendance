import { describe, expect, it } from "vitest"

import { computeAttendanceDay, type DayComputationInput } from "./day-computation"
import { DEFAULT_ATTENDANCE_SETTINGS } from "./settings"
import type { ShiftSpec } from "./shift"

const GEN: ShiftSpec = { id: "gen", name: "General", short: "G", startMin: 540, endMin: 1080, breakMin: 60 }

const day = (over: Partial<DayComputationInput> = {}): DayComputationInput => ({
  shift: GEN,
  dayKind: "WORKING",
  leave: null,
  punches: [],
  priorLateMarks: 0,
  settings: DEFAULT_ATTENDANCE_SETTINGS,
  ...over,
})

// 09:00 in, 18:00 out = 540 worked − no breaks. Offsets are from shift start.
const IN = (offsetMin: number) => ({ type: "IN" as const, offsetMin })
const OUT = (offsetMin: number) => ({ type: "OUT" as const, offsetMin })

describe("computeAttendanceDay — non-working days", () => {
  it("weekly off with no punches is paid and clean", () => {
    const r = computeAttendanceDay(day({ dayKind: "WEEKLY_OFF" }))
    expect(r.status).toBe("WEEKLY_OFF")
    expect(r.payableUnits).toBe(1)
    expect(r.needsApproval).toBe(false)
  })

  it("working on a holiday stays HOLIDAY and routes a comp-off claim", () => {
    const r = computeAttendanceDay(day({ dayKind: "HOLIDAY", punches: [IN(0), OUT(480)] }))
    expect(r.status).toBe("HOLIDAY")
    expect(r.payableUnits).toBe(1)
    expect(r.workedMinutes).toBe(480)
    expect(r.needsApproval).toBe(true)
  })
})

describe("computeAttendanceDay — leave", () => {
  it("approved full paid leave pays a full day", () => {
    const r = computeAttendanceDay(day({ leave: { part: "FULL", isPaid: true } }))
    expect(r.status).toBe("ON_LEAVE")
    expect(r.payableUnits).toBe(1)
  })

  it("approved full unpaid leave (LOP) pays nothing", () => {
    const r = computeAttendanceDay(day({ leave: { part: "FULL", isPaid: false } }))
    expect(r.payableUnits).toBe(0)
  })

  it("half-day paid leave + worked half pays a full day", () => {
    const r = computeAttendanceDay(
      day({ leave: { part: "FIRST_HALF", isPaid: true }, punches: [IN(270), OUT(540)] })
    )
    expect(r.status).toBe("ON_LEAVE_HALF")
    expect(r.payableUnits).toBe(1)
  })

  it("half-day leave with the other half not worked pays only the leave half", () => {
    const r = computeAttendanceDay(day({ leave: { part: "SECOND_HALF", isPaid: true } }))
    expect(r.status).toBe("ON_LEAVE_HALF")
    expect(r.payableUnits).toBe(0.5)
  })
})

describe("computeAttendanceDay — worked-hours ladder", () => {
  it("no punches, no leave → ABSENT 0", () => {
    const r = computeAttendanceDay(day())
    expect(r.status).toBe("ABSENT")
    expect(r.payableUnits).toBe(0)
  })

  it("≥ full-day hours → PRESENT 1.0", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(540)] }))
    expect(r.status).toBe("PRESENT")
    expect(r.payableUnits).toBe(1)
    expect(r.workedMinutes).toBe(540)
  })

  it("between half and full → HALF_DAY 0.5, reason WORKED_HOURS", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(300)] }))
    expect(r.status).toBe("HALF_DAY")
    expect(r.halfDayReason).toBe("WORKED_HOURS")
    expect(r.payableUnits).toBe(0.5)
  })

  it("under the half-day floor → ABSENT for payroll, but disputed via approval", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(120)] }))
    expect(r.status).toBe("ABSENT")
    expect(r.payableUnits).toBe(0)
    expect(r.needsApproval).toBe(true)
  })

  it("an explicit half-day choice wins over full worked hours (§3)", () => {
    const r = computeAttendanceDay(
      day({ explicitDayPart: "FIRST_HALF", punches: [IN(0), OUT(540)] })
    )
    expect(r.status).toBe("HALF_DAY")
    expect(r.halfDayReason).toBe("EMPLOYEE_SELECTED")
    expect(r.payableUnits).toBe(0.5)
  })

  it("breaks are subtracted from worked minutes", () => {
    const r = computeAttendanceDay(
      day({
        punches: [
          IN(0),
          { type: "BREAK_OUT", offsetMin: 240 },
          { type: "BREAK_IN", offsetMin: 285 },
          OUT(540),
        ],
      })
    )
    expect(r.workedMinutes).toBe(495)
  })
})

describe("computeAttendanceDay — missing punch-out", () => {
  it("IN without OUT → PENDING_APPROVAL, flagged, not payable yet", () => {
    const r = computeAttendanceDay(day({ punches: [IN(5)] }))
    expect(r.status).toBe("PENDING_APPROVAL")
    expect(r.flags).toContain("MISSING_PUNCH_OUT")
    expect(r.payableUnits).toBe(0)
    expect(r.needsApproval).toBe(true)
  })
})

describe("computeAttendanceDay — window flags and approval routing", () => {
  it("a punch outside the window is flagged and needs approval, never rejected", () => {
    const r = computeAttendanceDay(day({ punches: [IN(12), OUT(552)] }))
    expect(r.flags).toContain("LATE")
    expect(r.needsApproval).toBe(true)
    // +12 is inside the 15-minute grace, so no late mark despite the flag.
    expect(r.penaltyApplied).toBe("NONE")
    expect(r.payableUnits).toBe(1)
  })

  it("early exit beyond the window is flagged EARLY_EXIT", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(480)] }))
    expect(r.flags).toContain("EARLY_EXIT")
  })
})

describe("computeAttendanceDay — the late-mark penalty (user rule: 2 forgiven, 3rd is absent)", () => {
  it("3rd late of the month converts the day to ABSENT even with full hours", () => {
    const r = computeAttendanceDay(day({ priorLateMarks: 2, punches: [IN(20), OUT(560)] }))
    expect(r.penaltyApplied).toBe("ABSENT")
    expect(r.status).toBe("ABSENT")
    expect(r.payableUnits).toBe(0)
    expect(r.workedMinutes).toBeGreaterThan(0) // the work is recorded, the pay is not
  })

  it("HALF_DAY penalty caps a full day at 0.5 with the conversion reason", () => {
    const r = computeAttendanceDay(
      day({
        priorLateMarks: 2,
        punches: [IN(20), OUT(560)],
        settings: { ...DEFAULT_ATTENDANCE_SETTINGS, latePenalty: "HALF_DAY" },
      })
    )
    expect(r.status).toBe("HALF_DAY")
    expect(r.halfDayReason).toBe("LATE_MARK_CONVERSION")
    expect(r.payableUnits).toBe(0.5)
  })

  it("LOP penalty zeroes pay but keeps the day PRESENT", () => {
    const r = computeAttendanceDay(
      day({
        priorLateMarks: 2,
        punches: [IN(20), OUT(560)],
        settings: { ...DEFAULT_ATTENDANCE_SETTINGS, latePenalty: "LOP" },
      })
    )
    expect(r.status).toBe("PRESENT")
    expect(r.payableUnits).toBe(0)
  })
})

describe("computeAttendanceDay — overtime", () => {
  it("time past shift end at/over the minimum registers as OT", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(540 + 45)] }))
    expect(r.otMinutes).toBe(45)
  })

  it("below the OT minimum is ignored", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(540 + 20)] }))
    expect(r.otMinutes).toBe(0)
  })

  it("OT disabled kills the claim entirely", () => {
    const r = computeAttendanceDay(
      day({
        punches: [IN(0), OUT(540 + 90)],
        settings: { ...DEFAULT_ATTENDANCE_SETTINGS, otEnabled: false },
      })
    )
    expect(r.otMinutes).toBe(0)
  })
})

describe("computeAttendanceDay — declared half working day", () => {
  it("halves the expectation, not the pay: 4h on a half day is a FULL day", () => {
    const r = computeAttendanceDay(day({ dayKind: "HALF_DAY", punches: [IN(0), OUT(240)] }))
    expect(r.status).toBe("PRESENT")
    expect(r.payableUnits).toBe(1)
    expect(r.explanation).toMatch(/declared half working day/i)
  })

  it("the same 4h on a normal day is only a half day", () => {
    const r = computeAttendanceDay(day({ punches: [IN(0), OUT(240)] }))
    expect(r.status).toBe("HALF_DAY")
    expect(r.payableUnits).toBe(0.5)
  })

  it("2h on a half day is a half day — the ladder still applies, at halved thresholds", () => {
    const r = computeAttendanceDay(day({ dayKind: "HALF_DAY", punches: [IN(0), OUT(130)] }))
    expect(r.status).toBe("HALF_DAY")
    expect(r.payableUnits).toBe(0.5)
  })

  it("under the halved half-day floor is still absent for payroll", () => {
    const r = computeAttendanceDay(day({ dayKind: "HALF_DAY", punches: [IN(0), OUT(60)] }))
    expect(r.status).toBe("ABSENT")
    expect(r.payableUnits).toBe(0)
  })

  it("overtime on a half day starts after the shortened expectation", () => {
    const r = computeAttendanceDay(day({ dayKind: "HALF_DAY", punches: [IN(0), OUT(240 + 45)] }))
    expect(r.otMinutes).toBe(45)
  })

  it("no punches on a declared half day is still absent — it is a working day", () => {
    const r = computeAttendanceDay(day({ dayKind: "HALF_DAY" }))
    expect(r.status).toBe("ABSENT")
  })

  it("the late rule is unchanged on a half day", () => {
    const r = computeAttendanceDay(
      day({ dayKind: "HALF_DAY", priorLateMarks: 2, punches: [IN(25), OUT(265)] })
    )
    expect(r.penaltyApplied).toBe("ABSENT")
  })
})
