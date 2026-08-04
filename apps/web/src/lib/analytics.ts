import { DEFAULT_ATTENDANCE_SETTINGS, type DayStatus } from "@attendance/shared"

import { EMPLOYEES, type Employee } from "@/lib/seed"

/**
 * Per-employee analytics. Everything is derived from the same primitives the
 * real `attendance_days` table will expose, so the charts do not need reshaping
 * when the API lands — only the source swaps.
 */

function seeded(n: number) {
  const x = Math.sin(n) * 10_000
  return x - Math.floor(x)
}

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes) % 60).padStart(2, "0")}`

const SHIFT_START = 9 * 60

export interface DayRow {
  date: string
  status: DayStatus
  inAt: string | null
  outAt: string | null
  worked: string
  /** Negative = early, positive = late, null = did not attend. */
  arrivalMinutes: number | null
  insideGeofence: boolean
}

export interface EmployeeAnalytics {
  punctualityScore: number
  rank: number
  hasCrown: boolean
  averageArrival: string
  earliestArrival: string
  lateMarks: number
  lateAllowance: number
  graceMinutes: number
  otHours: number
  kpis: Array<{ label: string; value: string; hint: string }>
  workedSeries: Array<{ day: string; hours: number }>
  weekdayLate: Array<{ weekday: string; minutes: number }>
  arrivalSeries: Array<{ day: string; minutes: number }>
  monthlySeries: Array<{
    month: string
    present: number
    halfDay: number
    leave: number
    absent: number
  }>
  statusSplit: Array<{ status: DayStatus; label: string; count: number; fill: string }>
  recentDays: DayRow[]
}

/** Deterministic punctuality score so ranks and the crown stay stable. */
export function punctualityScoreFor(employee: Employee): number {
  const base = seeded(Number(employee.id.replace("emp_", "")) * 13 + 5)
  return Math.round(62 + base * 37)
}

/**
 * Monthly punctuality crown — the highest score of the month, and only awarded
 * if it clears a floor, so a bad month for everyone crowns nobody.
 */
export function crownHolder(): { employee: Employee; score: number } | null {
  const ranked = EMPLOYEES.map((employee) => ({
    employee,
    score: punctualityScoreFor(employee),
  })).sort((a, b) => b.score - a.score)

  const top = ranked[0]
  return top && top.score >= 85 ? top : null
}

export function rankedByPunctuality() {
  return EMPLOYEES.map((employee) => ({
    employee,
    score: punctualityScoreFor(employee),
  })).sort((a, b) => b.score - a.score)
}

const STATUS_FILL: Partial<Record<DayStatus, string>> = {
  PRESENT: "var(--status-present)",
  HALF_DAY: "var(--status-half-day)",
  ON_LEAVE: "var(--status-leave)",
  ABSENT: "var(--status-absent)",
  WFH: "var(--status-wfh)",
  ON_DUTY: "var(--status-on-duty)",
}

export function buildEmployeeAnalytics(employee: Employee): EmployeeAnalytics {
  const index = Number(employee.id.replace("emp_", ""))
  const score = punctualityScoreFor(employee)
  const ranked = rankedByPunctuality()
  const rank = ranked.findIndex((entry) => entry.employee.id === employee.id) + 1
  const crown = crownHolder()

  const arrivalSeries = Array.from({ length: 20 }, (_, day) => {
    const r = seeded(index * 31 + day)
    // Punctual people cluster below the line; the score shifts the whole band.
    const spread = 46 - (score - 62) * 0.9
    return { day: `${day + 1}`, minutes: Math.round((r - 0.55) * spread) }
  })

  const attended = arrivalSeries.map((point) => point.minutes)
  const averageArrival = clock(
    SHIFT_START + attended.reduce((sum, value) => sum + value, 0) / attended.length
  )
  const earliestArrival = clock(SHIFT_START + Math.min(...attended))
  const lateMarks = attended.filter(
    (minutes) => minutes > DEFAULT_ATTENDANCE_SETTINGS.lateGraceMinutes
  ).length

  const monthlySeries = ["Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((month, monthIndex) => {
    const r = seeded(index * 17 + monthIndex)
    const absent = Math.round(r * 2)
    const leave = Math.round(r * 3)
    const halfDay = Math.round(r * 2)
    return { month, present: 26 - absent - leave - halfDay, halfDay, leave, absent }
  })

  const current = monthlySeries[monthlySeries.length - 1]
  const statusSplit = (
    [
      ["PRESENT", "Present", current.present],
      ["HALF_DAY", "Half day", current.halfDay],
      ["ON_LEAVE", "Leave", current.leave],
      ["ABSENT", "Absent", current.absent],
    ] as Array<[DayStatus, string, number]>
  )
    .filter(([, , count]) => count > 0)
    .map(([status, label, count]) => ({
      status,
      label,
      count,
      fill: STATUS_FILL[status] ?? "var(--muted-foreground)",
    }))

  const recentDays: DayRow[] = Array.from({ length: 10 }, (_, dayIndex) => {
    const r = seeded(index * 71 + dayIndex)
    // Walk back a real calendar from 3 Aug. Clamping the day number instead
    // produced 2026-08-01 seven times over, which React flagged as duplicate
    // keys and which silently dropped rows.
    const cursor = new Date(2026, 7, 3 - dayIndex)
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
    const isLeave = r > 0.9
    const isAbsent = r > 0.96
    const attendedDay = !isLeave && !isAbsent
    const arrivalMinutes = attendedDay ? Math.round((r - 0.55) * 40) : null
    const workedMinutes = attendedDay ? 470 + Math.round(r * 50) : 0

    return {
      date,
      status: isAbsent ? "ABSENT" : isLeave ? "ON_LEAVE" : r < 0.1 ? "HALF_DAY" : "PRESENT",
      inAt: attendedDay ? clock(SHIFT_START + (arrivalMinutes ?? 0)) : null,
      outAt: attendedDay ? clock(SHIFT_START + (arrivalMinutes ?? 0) + workedMinutes + 60) : null,
      worked: attendedDay
        ? `${Math.floor(workedMinutes / 60)}h ${String(workedMinutes % 60).padStart(2, "0")}m`
        : "—",
      arrivalMinutes,
      insideGeofence: employee.isFieldEmployee ? true : r < 0.88,
    }
  })

  // Worked hours track arrivals: a very late day loses time, a normal day
  // lands around the 8h mark with ordinary jitter.
  const workedSeries = arrivalSeries.map((point, seriesIndex) => ({
    day: point.day,
    hours: Number(
      (7.4 + seeded(index * 13 + seriesIndex) * 1.4 - (point.minutes > 30 ? 1.6 : 0)).toFixed(1)
    ),
  }))

  // Which weekday the lateness clusters on — Monday usually earns its bump.
  const weekdayLate = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday, weekdayIndex) => ({
    weekday,
    minutes: Math.round(
      seeded(index * 7 + weekdayIndex) * 20 * (weekdayIndex === 0 ? 1.8 : 1)
    ),
  }))

  const otHours = Number((seeded(index * 3) * 12).toFixed(1))
  const avgWorked =
    workedSeries.reduce((sum, point) => sum + point.hours, 0) / workedSeries.length

  const kpis = [
    { label: "Present", value: String(current.present), hint: "days this month" },
    { label: "Half days", value: String(current.halfDay), hint: "this month" },
    { label: "Absent", value: String(current.absent), hint: "this month" },
    { label: "Late marks", value: `${lateMarks}/${DEFAULT_ATTENDANCE_SETTINGS.lateMarksAllowed}`, hint: "of allowance" },
    { label: "Avg worked", value: `${avgWorked.toFixed(1)}h`, hint: "per attended day" },
    { label: "Overtime", value: `${otHours}h`, hint: "approved, this month" },
  ]

  return {
    punctualityScore: score,
    rank,
    hasCrown: crown?.employee.id === employee.id,
    averageArrival,
    earliestArrival,
    lateMarks,
    lateAllowance: DEFAULT_ATTENDANCE_SETTINGS.lateMarksAllowed,
    graceMinutes: DEFAULT_ATTENDANCE_SETTINGS.lateGraceMinutes,
    otHours,
    kpis,
    workedSeries,
    weekdayLate,
    arrivalSeries,
    monthlySeries,
    statusSplit,
    recentDays,
  }
}
