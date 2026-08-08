import { describe, expect, it } from "vitest"

import {
  clockToMinutes,
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

  it("refuses an out time before the in time", () => {
    const result = regularisationRequestSchema.safeParse({
      ...base,
      inTime: "18:00",
      outTime: "09:00",
    })
    expect(result.success).toBe(false)
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
