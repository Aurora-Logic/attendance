import {
  computeAttendanceDay,
  countPriorLateMarks,
  earnedPaise,
  otPaise,
  perDayPaise,
  type AttendanceSettings,
  type RateBasis,
} from "@attendance/shared"

import type { CalendarDayRow } from "./repositories"
import type { PayrollRunItem, Store } from "./store"

/**
 * §6 run computation, v1: gross per employee (component structures and
 * statutory deductions are the deferred 7b scope). Everything reduces to the
 * one number the engine produces per day — payableUnits — summed over the
 * locked month, priced by the configured basis, plus approved OT.
 *
 * Pure function of the store: the run route and its tests call exactly this.
 */
export function computeRunItems(
  store: Store,
  month: string,
  calendarDays: Record<string, CalendarDayRow>
): PayrollRunItem[] {
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const settings: AttendanceSettings = store.settings

  return store.employees.map((employee) => {
    const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)
    if (!shift) {
      // Never skip silently — that is someone missing from the payroll run with no
      // trace. Fail loudly naming who to fix.
      throw new Error(
        `${employee.code} (${employee.name}) references shift ${employee.shiftId}, which does not exist. Fix the employee before running this.`
      )
    }
    const salary = store.salaries.find((candidate) => candidate.employeeId === employee.id)

    let payableDays = 0
    /**
     * Units lost on days the employee was expected to work. This — not the sum
     * of payable units — is what prices a month: a weekly off and a holiday
     * each accrue a payable unit, so summing them and multiplying by gross/26
     * paid a 31-day month as 31 days of salary.
     */
    let unpaidUnits = 0
    let workingDays = 0
    let otMinutes = 0

    for (let day = 1; day <= daysInMonth; day++) {
      const dateISO = `${month}-${String(day).padStart(2, "0")}`
      const declared = calendarDays[dateISO]
      const isWeeklyOff = new Date(`${dateISO}T00:00:00Z`).getUTCDay() === 0
      const dayKind =
        declared?.type === "HOLIDAY"
          ? ("HOLIDAY" as const)
          : isWeeklyOff
            ? ("WEEKLY_OFF" as const)
            : declared?.type === "HALF_DAY"
              ? ("HALF_DAY" as const)
              : ("WORKING" as const)
      if (dayKind === "WORKING" || dayKind === "HALF_DAY") workingDays += 1

      const punches = store.punches
        .filter((punch) => punch.employeeId === employee.id && punch.businessDate === dateISO)
        .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin }))

      const approvedLeave = store.approvals.find(
        (approval) =>
          approval.kind === "LEAVE" &&
          approval.status === "APPROVED" &&
          approval.employeeId === employee.id &&
          approval.dateFrom <= dateISO &&
          dateISO <= approval.dateTo
      )

      const result = computeAttendanceDay({
        shift,
        dayKind,
        leave: approvedLeave
          ? { part: approvedLeave.leavePart ?? "FULL", isPaid: approvedLeave.leaveType !== "LOP" }
          : null,
        punches,
        // The register applies the late penalty; payroll must price the same
        // day. Passing 0 here paid days the register showed as ABSENT.
        priorLateMarks: countPriorLateMarks(
          store.punches.filter((punch) => punch.employeeId === employee.id),
          dateISO,
          settings.lateGraceMinutes
        ),
        settings,
      })
      payableDays += result.payableUnits
      // Only a day the company expected to be worked can be lost. Weekly offs
      // and holidays are already paid inside the divisor.
      if (dayKind === "WORKING" || dayKind === "HALF_DAY") {
        unpaidUnits += Math.max(1 - result.payableUnits, 0)
      }

      /**
       * The day records what was *worked*; payroll pays what was *approved*.
       * Without this gate, staying late silently became money — the OVERTIME
       * approval kind existed but nothing ever created or consumed it, so the
       * whole claim path was decorative. `units` on an approved OT request is
       * minutes, capped at what the day actually earned so an approval cannot
       * conjure hours that were never worked.
       */
      if (settings.otRequiresApproval) {
        const approvedOt = store.approvals
          .filter(
            (approval) =>
              approval.kind === "OVERTIME" &&
              approval.status === "APPROVED" &&
              approval.employeeId === employee.id &&
              approval.dateFrom <= dateISO &&
              dateISO <= approval.dateTo
          )
          .reduce((sum, approval) => sum + approval.units, 0)
        otMinutes += Math.min(approvedOt, result.otMinutes)
      } else {
        otMinutes += result.otMinutes
      }
    }

    const grossMonthly = salary?.grossMonthlyPaise ?? 0
    const basis: RateBasis = salary?.basis ?? "FIXED_26"
    const ctx = { calendarDays: daysInMonth, workingDays }
    const perDay = perDayPaise(grossMonthly, basis, ctx)
    const earned = earnedPaise(grossMonthly, basis, ctx, unpaidUnits)
    const otPay = otPaise(
      grossMonthly,
      basis,
      ctx,
      otMinutes,
      settings.otMultiplier,
      settings.fullDayMinHours
    )

    return {
      employeeId: employee.id,
      code: employee.code,
      name: employee.name,
      payableDays,
      perDayPaise: perDay,
      earnedPaise: earned,
      otMinutes,
      otPaise: otPay,
      grossPaise: earned + otPay,
    }
  })
}
