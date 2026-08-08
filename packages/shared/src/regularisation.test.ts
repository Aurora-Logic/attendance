import { describe, expect, it } from "vitest"

import {
  clockToMinutes,
  offsetForShift,
  regularisationOrderingError,
  regularisationPunches,
  regularisationRequestSchema,
  regularisationSubject,
  type RegularisationRequest,
} from "./regularisation"

const base: RegularisationRequest = {
  date: "2026-08-07",
  reason: "MISSED_OUT",
  outTime: "18:30",
  note: "Phone battery died before I could punch out.",
}

describe("regularisationRequestSchema", () => {
  it("accepts a request that corrects one end of the day", () => {
    expect(regularisationRequestSchema.safeParse(base).success).toBe(true)
    expect(
      regularisationRequestSchema.safeParse({
        ...base,
        reason: "MISSED_IN",
        inTime: "09:05",
        outTime: undefined,
      }).success
    ).toBe(true)
  })

  it("refuses a request that corrects nothing", () => {
    const result = regularisationRequestSchema.safeParse({
      ...base,
      inTime: undefined,
      outTime: undefined,
    })
    expect(result.success).toBe(false)
  })

  it("leaves ordering to the route — the schema cannot know the shift", () => {
    // 06:00 legitimately follows 22:00 on a night shift, so a string compare
    // here would refuse every night-shift correction outright.
    expect(
      regularisationRequestSchema.safeParse({ ...base, inTime: "22:00", outTime: "06:00" }).success
    ).toBe(true)
  })

  it("requires a real explanation and a 24-hour clock", () => {
    expect(regularisationRequestSchema.safeParse({ ...base, note: "x" }).success).toBe(false)
    expect(regularisationRequestSchema.safeParse({ ...base, outTime: "6:30pm" }).success).toBe(false)
    expect(regularisationRequestSchema.safeParse({ ...base, outTime: "25:00" }).success).toBe(false)
  })
})

describe("regularisationPunches", () => {
  const shiftStart = 9 * 60 // 09:00

  it("converts clock times into shift-relative offsets", () => {
    expect(regularisationPunches({ ...base, inTime: "09:05" }, shiftStart)).toEqual([
      { type: "IN", offsetMin: 5, clock: "09:05" },
      { type: "OUT", offsetMin: 570, clock: "18:30" },
    ])
  })

  it("produces a negative offset for an early arrival", () => {
    const punches = regularisationPunches(
      { ...base, reason: "MISSED_IN", inTime: "08:40", outTime: undefined },
      shiftStart
    )
    expect(punches).toEqual([{ type: "IN", offsetMin: -20, clock: "08:40" }])
  })

  it("emits only the ends the employee asked to correct", () => {
    expect(regularisationPunches(base, shiftStart)).toHaveLength(1)
    expect(regularisationPunches(base, shiftStart)[0].type).toBe("OUT")
  })

  it("clockToMinutes handles midnight and the last minute of the day", () => {
    expect(clockToMinutes("00:00")).toBe(0)
    expect(clockToMinutes("23:59")).toBe(1439)
  })
})

describe("regularisationSubject", () => {
  it("reads as one scannable line in the approvals inbox", () => {
    expect(regularisationSubject(base)).toBe("Missed punch-out — out 18:30")
    expect(regularisationSubject({ ...base, reason: "WRONG_TIME", inTime: "09:05" })).toBe(
      "Recorded time is wrong — in 09:05, out 18:30"
    )
  })
})


describe("night shifts wrap past midnight", () => {
  const NIGHT_START = 22 * 60 // 22:00
  const DAY_START = 9 * 60

  it("an out time before the shift start belongs to the next day", () => {
    // 06:00 on a 22:00 shift is eight hours in, not sixteen hours before it.
    expect(offsetForShift("06:00", NIGHT_START, true)).toBe(480)
    expect(offsetForShift("22:00", NIGHT_START, true)).toBe(0)
    expect(offsetForShift("23:30", NIGHT_START, true)).toBe(90)
  })

  it("a day shift is unaffected — a time before the start stays negative", () => {
    expect(offsetForShift("08:40", DAY_START, false)).toBe(-20)
    expect(offsetForShift("09:05", DAY_START, false)).toBe(5)
  })

  it("night-shift punches come out in the right order", () => {
    const punches = regularisationPunches(
      { date: "2026-08-10", reason: "MISSED_OUT", inTime: "22:00", outTime: "06:00", note: "night" },
      NIGHT_START,
      true
    )
    expect(punches).toEqual([
      { type: "IN", offsetMin: 0, clock: "22:00" },
      { type: "OUT", offsetMin: 480, clock: "06:00" },
    ])
    // Without the wrap this was -960: the correction produced a day with
    // negative worked time and the employee stayed unpaid.
    expect(punches[1].offsetMin).toBeGreaterThan(punches[0].offsetMin)
  })

  it("ordering is judged against the shift, not the clock string", () => {
    const night = { date: "2026-08-10", reason: "MISSED_OUT" as const, inTime: "22:00", outTime: "06:00", note: "night" }
    expect(regularisationOrderingError(night, NIGHT_START, true)).toBeNull()
    // The same pair on a day shift really is the wrong way round.
    expect(regularisationOrderingError(night, DAY_START, false)).toMatch(/after in time/)
    // And an identical in and out is refused on any shift.
    expect(
      regularisationOrderingError(
        { ...night, inTime: "22:00", outTime: "22:00" },
        NIGHT_START,
        true
      )
    ).toMatch(/after in time/)
  })
})
