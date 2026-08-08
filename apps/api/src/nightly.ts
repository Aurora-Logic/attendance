import { recentCompanyDates } from "@attendance/shared"

import { persistApproval } from "./repositories"
import type { Store } from "./store"
import { id } from "./store"

/**
 * §3 nightly close: anyone with an IN but no OUT for a business date gets the
 * day flagged MISSING_PUNCH_OUT and a regularisation request raised to them.
 * Idempotent — a re-run for the same date creates nothing twice — so the boot
 * catch-up and the hourly timer can overlap safely.
 */
export function runNightlyClose(store: Store, dateISO: string): { closed: string[] } {
  const closed: string[] = []

  for (const employee of store.employees) {
    const punches = store.punches.filter(
      (punch) => punch.employeeId === employee.id && punch.businessDate === dateISO
    )
    const hasIn = punches.some((punch) => punch.type === "IN")
    const hasOut = punches.some((punch) => punch.type === "OUT")
    if (!hasIn || hasOut) continue

    const alreadyRaised = store.approvals.some(
      (approval) =>
        approval.kind === "REGULARISATION" &&
        approval.employeeId === employee.id &&
        approval.dateFrom === dateISO &&
        approval.subject.startsWith("Missed punch-out")
    )
    if (alreadyRaised) continue

    store.approvals.push({
      id: id(store, "req"),
      kind: "REGULARISATION",
      employeeId: employee.id,
      subject: `Missed punch-out · ${dateISO}`,
      detail:
        "The day auto-closed with no OUT punch. Confirm the actual leaving time so the day can be computed.",
      dateFrom: dateISO,
      dateTo: dateISO,
      units: 0,
      status: "PENDING",
      level: 1,
      createdAt: new Date().toISOString(),
    })
    persistApproval(store.approvals.at(-1)!)
    closed.push(employee.id)
  }

  return { closed }
}

/**
 * How many days back each sweep looks. Examining only yesterday meant a
 * weekend outage, or a container that was down on Monday, silently skipped
 * those days forever — nothing would ever raise their missed punch-outs. The
 * close is idempotent, so re-examining a week costs nothing and self-heals.
 */
const LOOKBACK_DAYS = 7

/** Boot catch-up over the recent window, then an hourly re-check. */
export function scheduleNightlyClose(store: Store, log = console.log): void {
  const run = () => {
    // The company's calendar, not the server's: in Asia/Kolkata anything
    // before 05:30 local still reports the previous day in UTC, so a job that
    // used toISOString() closed the wrong date every early morning.
    for (const date of recentCompanyDates(store.settings.timezone, LOOKBACK_DAYS)) {
      const { closed } = runNightlyClose(store, date)
      if (closed.length > 0) {
        log(`nightly close: ${closed.length} missed punch-out(s) for ${date}`)
      }
    }
  }
  run()
  setInterval(run, 3_600_000).unref()
}
