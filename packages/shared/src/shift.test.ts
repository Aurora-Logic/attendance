import { describe, expect, it } from "vitest"

import { DEFAULT_ATTENDANCE_SETTINGS as S } from "./settings"
import { companyToday, crossesMidnight, isRealISODate, offsetFromShiftStart, punchWindowFlag, recentCompanyDates, resolveBusinessDate, shiftLengthMin, type ShiftSpec } from "./shift"

const DAY: ShiftSpec = { id: "gen", name: "General", short: "G", startMin: 540, endMin: 1080, breakMin: 60 }
const NIGHT: ShiftSpec = { id: "night", name: "Night", short: "N", startMin: 1320, endMin: 360, breakMin: 30 }

describe("shift geometry", () => {
  it("detects midnight crossing and computes length", () => {
    expect(crossesMidnight(DAY)).toBe(false)
    expect(crossesMidnight(NIGHT)).toBe(true)
    expect(shiftLengthMin(DAY)).toBe(540)
    expect(shiftLengthMin(NIGHT)).toBe(480)
  })
})

describe("resolveBusinessDate — the night-shift rule", () => {
  it("day shift: punch date is the business date", () => {
    expect(resolveBusinessDate("2026-08-05", 545, DAY, S)).toBe("2026-08-05")
  })

  it("01:00 on the 5th, on 22:00–06:00, belongs to the 4th", () => {
    expect(resolveBusinessDate("2026-08-05", 60, NIGHT, S)).toBe("2026-08-04")
  })

  it("punch-out at 06:05 (inside the after-window) still belongs to the previous day", () => {
    expect(resolveBusinessDate("2026-08-05", 365, NIGHT, S)).toBe("2026-08-04")
  })

  it("an afternoon punch belongs to the upcoming night, not the finished one", () => {
    expect(resolveBusinessDate("2026-08-05", 720, NIGHT, S)).toBe("2026-08-05")
  })

  it("21:50 before a 22:00 start is the same business date", () => {
    expect(resolveBusinessDate("2026-08-04", 1310, NIGHT, S)).toBe("2026-08-04")
  })

  it("crosses month boundaries correctly", () => {
    expect(resolveBusinessDate("2026-08-01", 120, NIGHT, S)).toBe("2026-07-31")
  })
})

describe("offsetFromShiftStart", () => {
  it("day shift is plain subtraction", () => {
    expect(offsetFromShiftStart(555, DAY, S)).toBe(15)
    expect(offsetFromShiftStart(530, DAY, S)).toBe(-10)
  })

  it("night shift wraps: 01:00 is +180 from a 22:00 start", () => {
    expect(offsetFromShiftStart(60, NIGHT, S)).toBe(180)
  })

  it("night shift pre-start: 21:50 is −10", () => {
    expect(offsetFromShiftStart(1310, NIGHT, S)).toBe(-10)
  })
})

describe("punchWindowFlag — window vs grace are different thresholds", () => {
  it("inside the ±10 window is ON_TIME", () => {
    expect(punchWindowFlag("IN", -10, DAY, S)).toBe("ON_TIME")
    expect(punchWindowFlag("IN", 0, DAY, S)).toBe("ON_TIME")
    expect(punchWindowFlag("IN", 10, DAY, S)).toBe("ON_TIME")
  })

  it("earlier than the before-window is EARLY", () => {
    expect(punchWindowFlag("IN", -11, DAY, S)).toBe("EARLY")
  })

  it("+12 is outside the 10-minute window (flagged) even though inside the 15-minute grace", () => {
    expect(punchWindowFlag("IN", 12, DAY, S)).toBe("LATE")
  })

  it("leaving early beyond the window is EARLY_EXIT", () => {
    expect(punchWindowFlag("OUT", shiftLengthMin(DAY) - 11, DAY, S)).toBe("EARLY_EXIT")
  })

  it("an OUT beyond the after-window is overtime, not a violation", () => {
    expect(punchWindowFlag("OUT", shiftLengthMin(DAY) + 90, DAY, S)).toBe("ON_TIME")
  })
})

describe("companyToday", () => {
  it("uses the company's calendar, not the server's UTC date", () => {
    // 02:00 IST on 8 Aug is still 7 Aug in UTC — the off-by-one that made the
    // nightly close examine the wrong day.
    const earlyMorningIst = new Date("2026-08-07T20:30:00Z")
    expect(companyToday("Asia/Kolkata", earlyMorningIst)).toBe("2026-08-08")
    expect(companyToday("UTC", earlyMorningIst)).toBe("2026-08-07")
  })

  it("agrees with UTC in the middle of the day", () => {
    const midday = new Date("2026-08-07T09:00:00Z")
    expect(companyToday("Asia/Kolkata", midday)).toBe("2026-08-07")
  })
})

describe("recentCompanyDates", () => {
  it("returns the window oldest first, excluding today", () => {
    const now = new Date("2026-08-08T09:00:00Z")
    expect(recentCompanyDates("Asia/Kolkata", 3, now)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ])
  })
})

describe("isRealISODate", () => {
  it("accepts real dates, including a leap day", () => {
    expect(isRealISODate("2026-08-08")).toBe(true)
    expect(isRealISODate("2024-02-29")).toBe(true)
    expect(isRealISODate("2026-12-31")).toBe(true)
    expect(isRealISODate("2026-01-01")).toBe(true)
  })

  it("rejects dates that pass the shape check but do not exist", () => {
    // The whole point: these are what the bare regex let through.
    expect(isRealISODate("2026-02-31")).toBe(false)
    expect(isRealISODate("2026-02-29")).toBe(false) // 2026 is not a leap year
    expect(isRealISODate("2026-04-31")).toBe(false)
    expect(isRealISODate("2026-13-01")).toBe(false)
    expect(isRealISODate("2026-00-10")).toBe(false)
    expect(isRealISODate("2026-01-00")).toBe(false)
  })

  it("rejects anything that is not the ISO shape at all", () => {
    expect(isRealISODate("08/08/2026")).toBe(false)
    expect(isRealISODate("2026-8-8")).toBe(false)
    expect(isRealISODate("")).toBe(false)
    expect(isRealISODate("2026-08-08T09:00")).toBe(false)
  })
})
