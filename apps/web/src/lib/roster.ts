import type { DayStatus, ShiftSpec } from "@attendance/shared"

import type { RosterConfig, WeeklyOffPattern } from "@/lib/app-config"
import { EMPLOYEES, type Employee } from "@/lib/seed"

/**
 * Roster generation is a pure function of the configuration — never a copy of
 * last week. Everything an admin can change lives in RosterConfig (edited on
 * the Settings → Roster & shifts tab); a human only records exceptions, which
 * land as manual overrides.
 */

export type CellSource = "WEEKLY_OFF" | "HOLIDAY" | "HALF_DAY" | "ROTATION" | "DEFAULT" | "MANUAL"

export interface RosterCell {
  day: number
  dateISO: string
  status: DayStatus
  shift: ShiftSpec | null
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

export const isoWeek = (date: Date): number => {
  const target = new Date(date.valueOf())
  const dayNumber = (date.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNumber + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  return 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / (7 * 24 * 3600 * 1000))
}

const patternFor = (employee: Employee, config: RosterConfig): WeeklyOffPattern => {
  const patternId = config.departmentPatterns[employee.department]
  return config.patterns.find((pattern) => pattern.id === patternId) ?? config.patterns[0]
}

const isWeeklyOff = (pattern: WeeklyOffPattern, date: Date): boolean => {
  if (pattern.fixedDays.includes(date.getDay())) return true
  if (pattern.alternateSaturdays.length > 0 && date.getDay() === 6) {
    return pattern.alternateSaturdays.includes(Math.ceil(date.getDate() / 7))
  }
  return false
}

const toISO = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`

export function generateRoster(
  year: number,
  month: number,
  config: RosterConfig,
  employees: Employee[] = EMPLOYEES
): RosterRow[] {
  const enabled = new Set(config.rules.filter((rule) => rule.enabled).map((rule) => rule.id))
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const defaultShift = config.shifts[0]
  const nightIds = new Set(
    config.shifts.filter((shift) => shift.endMin <= shift.startMin).map((shift) => shift.id)
  )

  return employees.map((employee, index) => {
    const pattern = patternFor(employee, config)
    let workingDays = 0
    let nightDays = 0

    const cells: RosterCell[] = Array.from({ length: daysInMonth }, (_, dayIndex) => {
      const day = dayIndex + 1
      const date = new Date(year, month, day)
      const dateISO = toISO(year, month, day)

      const holidayName = enabled.has("holidays") ? config.holidays[dateISO] : undefined
      if (holidayName) {
        return { day, dateISO, status: "HOLIDAY" as DayStatus, shift: null, source: "HOLIDAY" as CellSource, note: holidayName }
      }

      // A declared half day is still a working day — it keeps its shift and
      // counts toward working days; only the expectation halves.
      const halfDayName = enabled.has("holidays") ? config.halfDays[dateISO] : undefined

      if (enabled.has("weekly-off") && isWeeklyOff(pattern, date)) {
        return { day, dateISO, status: "WEEKLY_OFF" as DayStatus, shift: null, source: "WEEKLY_OFF" as CellSource, note: pattern.name }
      }

      let shift: ShiftSpec | null = null
      let source: CellSource = "DEFAULT"
      if (
        enabled.has("rotation") &&
        config.rotation.enabled &&
        employee.department === config.rotation.department &&
        config.rotation.cycle.length > 0
      ) {
        const cycleId =
          config.rotation.cycle[(isoWeek(date) + index) % config.rotation.cycle.length]
        shift = config.shifts.find((candidate) => candidate.id === cycleId) ?? defaultShift
        source = "ROTATION"
      } else if (enabled.has("default-shift")) {
        shift = employee.shift.startsWith("Night")
          ? (config.shifts.find((candidate) => nightIds.has(candidate.id)) ?? defaultShift)
          : defaultShift
      } else {
        shift = defaultShift
      }

      workingDays += 1
      if (nightIds.has(shift.id)) nightDays += 1

      if (halfDayName) {
        return {
          day,
          dateISO,
          status: "PRESENT" as DayStatus,
          shift,
          source: "HALF_DAY" as CellSource,
          note: `${halfDayName} · half working day`,
        }
      }

      return {
        day,
        dateISO,
        status: "PRESENT" as DayStatus,
        shift,
        source,
        note:
          source === "ROTATION"
            ? `Rotation week ${isoWeek(date)} · ${shift.name}`
            : `Default shift · ${shift.name}`,
      }
    })

    return { employee, pattern, cells, workingDays, nightDays }
  })
}
