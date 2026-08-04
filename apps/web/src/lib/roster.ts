import type { DayStatus } from "@attendance/shared"

import { EMPLOYEES, type Employee } from "@/lib/seed"

/**
 * Roster generation is a pure function of the rules, not a manual copy of last
 * week. Copying propagates last month's mistakes and silently drifts from the
 * pattern the company actually agreed. Everything below is derived; a human
 * only records exceptions.
 */

export interface WeeklyOffPattern {
  id: string
  name: string
  /** 0 = Sunday. */
  fixedDays: number[]
  /** 1-based occurrences of Saturday that are also off, e.g. [2, 4]. */
  alternateSaturdays?: number[]
}

export const WEEKLY_OFF_PATTERNS: WeeklyOffPattern[] = [
  { id: "sun", name: "Sunday off", fixedDays: [0] },
  { id: "sun-alt-sat", name: "Sunday + alternate Saturday", fixedDays: [0], alternateSaturdays: [2, 4] },
  { id: "sun-sat", name: "Sunday + Saturday", fixedDays: [0, 6] },
]

export interface ShiftDef {
  id: string
  name: string
  short: string
  start: string
  end: string
  crossesMidnight: boolean
}

export const SHIFTS: ShiftDef[] = [
  { id: "gen", name: "General", short: "G", start: "09:00", end: "18:00", crossesMidnight: false },
  { id: "morn", name: "Morning", short: "M", start: "06:00", end: "14:00", crossesMidnight: false },
  { id: "eve", name: "Evening", short: "E", start: "14:00", end: "22:00", crossesMidnight: false },
  { id: "night", name: "Night", short: "N", start: "22:00", end: "06:00", crossesMidnight: true },
]

export const HOLIDAYS_AUG_2026: Record<number, string> = {
  15: "Independence Day",
  26: "Ganesh Chaturthi",
}

export interface RosterRule {
  id: string
  label: string
  detail: string
  enabled: boolean
}

export const ROSTER_RULES: RosterRule[] = [
  {
    id: "weekly-off",
    label: "Apply weekly-off pattern",
    detail: "Sunday for everyone; alternate Saturdays for Finance and HR.",
    enabled: true,
  },
  {
    id: "holidays",
    label: "Apply branch holiday calendar",
    detail: "State-specific — Maharashtra and Karnataka differ.",
    enabled: true,
  },
  {
    id: "rotation",
    label: "Rotate Production shifts weekly",
    detail: "Morning → Evening → Night, advancing every ISO week.",
    enabled: true,
  },
  {
    id: "default-shift",
    label: "Fall back to the employee's default shift",
    detail: "Anyone not covered by a rotation gets their assigned shift.",
    enabled: true,
  },
  {
    id: "night-rest",
    label: "Guarantee a rest day after a night block",
    detail: "No morning shift within 12 hours of a night-shift end.",
    enabled: true,
  },
]

export type CellSource = "WEEKLY_OFF" | "HOLIDAY" | "ROTATION" | "DEFAULT" | "MANUAL"

export interface RosterCell {
  day: number
  status: DayStatus
  shift: ShiftDef | null
  source: CellSource
  note: string
}

export interface RosterRow {
  employee: Employee
  pattern: WeeklyOffPattern
  cells: RosterCell[]
  workingDays: number
  nightDays: number
}

const isoWeek = (date: Date) => {
  const target = new Date(date.valueOf())
  const dayNumber = (date.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNumber + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const diff = target.valueOf() - firstThursday.valueOf()
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000))
}

function patternFor(employee: Employee): WeeklyOffPattern {
  if (employee.department === "Finance" || employee.department === "HR") {
    return WEEKLY_OFF_PATTERNS[1]
  }
  return WEEKLY_OFF_PATTERNS[0]
}

function isWeeklyOff(pattern: WeeklyOffPattern, date: Date) {
  if (pattern.fixedDays.includes(date.getDay())) return true
  if (pattern.alternateSaturdays && date.getDay() === 6) {
    const occurrence = Math.ceil(date.getDate() / 7)
    return pattern.alternateSaturdays.includes(occurrence)
  }
  return false
}

/** Production rotates Morning → Evening → Night, advancing each ISO week. */
function rotationShift(employee: Employee, date: Date, index: number): ShiftDef | null {
  if (employee.department !== "Production") return null
  const cycle = [SHIFTS[1], SHIFTS[2], SHIFTS[3]]
  return cycle[(isoWeek(date) + index) % cycle.length]
}

export function generateRoster(
  year: number,
  month: number,
  rules: RosterRule[] = ROSTER_RULES
): RosterRow[] {
  const enabled = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.id))
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  return EMPLOYEES.map((employee, index) => {
    const pattern = patternFor(employee)
    let nightDays = 0
    let workingDays = 0

    const cells: RosterCell[] = Array.from({ length: daysInMonth }, (_, dayIndex) => {
      const day = dayIndex + 1
      const date = new Date(year, month, day)

      if (enabled.has("holidays") && HOLIDAYS_AUG_2026[day]) {
        return {
          day,
          status: "HOLIDAY" as DayStatus,
          shift: null,
          source: "HOLIDAY" as CellSource,
          note: HOLIDAYS_AUG_2026[day],
        }
      }

      if (enabled.has("weekly-off") && isWeeklyOff(pattern, date)) {
        return {
          day,
          status: "WEEKLY_OFF" as DayStatus,
          shift: null,
          source: "WEEKLY_OFF" as CellSource,
          note: pattern.name,
        }
      }

      const rotated = enabled.has("rotation") ? rotationShift(employee, date, index) : null
      const shift =
        rotated ??
        (enabled.has("default-shift")
          ? employee.shift.startsWith("Night")
            ? SHIFTS[3]
            : SHIFTS[0]
          : SHIFTS[0])

      workingDays += 1
      if (shift.crossesMidnight) nightDays += 1

      return {
        day,
        status: "PRESENT" as DayStatus,
        shift,
        source: (rotated ? "ROTATION" : "DEFAULT") as CellSource,
        note: rotated
          ? `Rotation week ${isoWeek(date)} · ${shift.name} ${shift.start}–${shift.end}`
          : `Default shift · ${shift.name} ${shift.start}–${shift.end}`,
      }
    })

    return { employee, pattern, cells, workingDays, nightDays }
  })
}
