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
    closed.push(employee.id)
  }

  return { closed }
}

/** Boot catch-up for yesterday, then an hourly re-check. */
export function scheduleNightlyClose(store: Store): void {
  const run = () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const { closed } = runNightlyClose(store, yesterday)
    if (closed.length > 0) {
      console.log(`nightly close: ${closed.length} missed punch-out(s) for ${yesterday}`)
    }
  }
  run()
  setInterval(run, 3_600_000).unref()
}
