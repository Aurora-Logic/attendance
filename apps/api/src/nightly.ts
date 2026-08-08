import {
  compOffExpiries,
  companyToday,
  recentCompanyDates,
  shouldEscalate,
} from "@attendance/shared"

import { applyApproval, canApplyApproval } from "./approve"
import type { NotifyInput } from "./notify"
import { persistApproval, persistLedgerEntry } from "./repositories"
import type { Store } from "./store"
import { id } from "./store"

/**
 * §3 nightly close: anyone with an IN and no OUT for a business date is told,
 * so they can file the correction themselves.
 *
 * It used to *raise* a PENDING regularisation on their behalf, which did two
 * things wrong. The employee could then not file their own — the duplicate
 * guard refused it as ALREADY_PENDING — and the placeholder carried no times,
 * because only the employee knows when they actually left. Approving it wrote
 * nothing at all while reporting success and telling them the day was fixed.
 *
 * A prompt is the honest shape: the system noticed, the employee supplies the
 * facts, a manager approves the real request.
 *
 * Idempotent — a re-run for the same date notifies nobody twice — so the boot
 * catch-up and the hourly timer can overlap safely.
 */
export function runNightlyClose(
  store: Store,
  dateISO: string,
  notify?: (input: NotifyInput) => void
): { closed: string[] } {
  const closed: string[] = []

  for (const employee of store.employees) {
    const punches = store.punches.filter(
      (punch) => punch.employeeId === employee.id && punch.businessDate === dateISO
    )
    const hasIn = punches.some((punch) => punch.type === "IN")
    const hasOut = punches.some((punch) => punch.type === "OUT")
    if (!hasIn || hasOut) continue

    // Already told, or the employee has already filed for that day.
    const known =
      store.notifications.some(
        (entry) =>
          entry.employeeId === employee.id &&
          entry.kind === "PUNCH_FLAGGED" &&
          entry.body.includes(dateISO)
      ) ||
      store.approvals.some(
        (approval) =>
          approval.kind === "REGULARISATION" &&
          approval.employeeId === employee.id &&
          approval.dateFrom === dateISO
      )
    if (known) continue

    notify?.({
      employeeId: employee.id,
      kind: "PUNCH_FLAGGED",
      title: "You did not punch out",
      body: `${dateISO} closed with no out-punch. Regularise it so the day can be computed.`,
      href: "/attendance",
    })
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
export function scheduleNightlyClose(
  store: Store,
  log = console.log,
  notify?: (input: NotifyInput) => void
): void {
  const run = () => {
    // The company's calendar, not the server's: in Asia/Kolkata anything
    // before 05:30 local still reports the previous day in UTC, so a job that
    // used toISOString() closed the wrong date every early morning.
    for (const date of recentCompanyDates(store.settings.timezone, LOOKBACK_DAYS)) {
      const { closed } = runNightlyClose(store, date, notify)
      if (closed.length > 0) {
        log(`nightly close: ${closed.length} missed punch-out(s) for ${date}`)
      }
    }
    const { expired } = expireCompOff(store, companyToday(store.settings.timezone))
    if (expired > 0) log(`comp-off: ${expired} unused day(s) expired`)

    if (notify) {
      const { escalated, autoApproved } = escalateStaleApprovals(
        store,
        new Date().toISOString(),
        notify
      )
      if (escalated > 0)
        log(`approvals: ${escalated} escalated to L2${autoApproved > 0 ? `, ${autoApproved} auto-approved` : ""}`)
    }
  }
  run()
  setInterval(run, 3_600_000).unref()
}

/**
 * Expire stale comp-off credits. A credit that never expires is a liability
 * that grows forever, and the employee's balance stops meaning "days I can
 * actually take". Consumption is oldest-first, so a debit always burns the
 * credit nearest expiry — the arrangement that loses the employee the least.
 *
 * Idempotent: an expiry writes a negative ADJUST row that the next sweep
 * counts as consumption, so re-running never expires the same credit twice.
 */
export function expireCompOff(store: Store, todayISO: string): { expired: number } {
  if (!store.settings.compOffEnabled) return { expired: 0 }
  let expired = 0

  for (const employee of store.employees) {
    const rows = store.ledger.filter(
      (row) => row.employeeId === employee.id && row.type === "COMP_OFF"
    )
    const credits = rows
      .filter((row) => row.units > 0)
      .map((row) => ({ earnedISO: row.date, units: row.units }))
    // Everything that has already left the balance — leave taken and earlier
    // expiries alike — is consumption for FIFO purposes.
    const debits = rows
      .filter((row) => row.units < 0)
      .reduce((sum, row) => sum + Math.abs(row.units), 0)

    for (const lot of compOffExpiries(credits, debits, store.settings.compOffExpiryDays, todayISO)) {
      store.ledger.push({
        id: id(store, "l"),
        employeeId: employee.id,
        type: "COMP_OFF",
        txnType: "ADJUST",
        units: -lot.units,
        date: todayISO,
        remarks: `Expired — earned ${lot.earnedISO}, unused after ${store.settings.compOffExpiryDays} days`,
      })
      persistLedgerEntry(store.ledger.at(-1)!)
      expired += lot.units
    }
  }
  return { expired }
}

/**
 * Move stale requests up. `approvalEscalateAfterDays` and
 * `autoApproveOnEscalation` were configurable from the first commit and had
 * never once fired: a manager on leave silently stalled every request routed
 * to them, with nothing surfacing that anywhere.
 *
 * Escalation is a state change, not a decision — an L2 request still needs
 * someone to act on it, unless the company explicitly opted into auto-approve.
 * Idempotent: a request already at L2 is skipped, so the hourly sweep cannot
 * escalate the same thing twice.
 */
export function escalateStaleApprovals(
  store: Store,
  nowISO: string,
  notify: (input: NotifyInput) => void
): { escalated: number; autoApproved: number } {
  let escalated = 0
  let autoApproved = 0

  for (const approval of store.approvals) {
    if (approval.status !== "PENDING" || approval.level !== 1) continue
    if (!shouldEscalate(approval.createdAt, store.settings.approvalEscalateAfterDays, nowISO))
      continue

    approval.level = 2
    escalated += 1

    if (store.settings.autoApproveOnEscalation) {
      /**
       * Auto-approval used to set the status and stop there: leave was granted
       * without ever debiting the ledger, comp-off without a credit, and a
       * regularisation without the punches that are its whole point. It now
       * goes through the same gate and the same applier as a human decision.
       *
       * If it cannot be applied — a balance that no longer covers it — the
       * request stays PENDING at L2 for a person to resolve. Silently approving
       * something the ledger cannot absorb would drive the balance negative and
       * permanently break that employee's leave routes.
       */
      const check = canApplyApproval(store, approval)
      if (!check.ok) {
        notify({
          employeeId: approval.employeeId,
          kind: "APPROVAL_ESCALATED",
          title: "Escalated — needs a person",
          body: `${approval.subject} could not be auto-approved: ${check.detail}`,
          href: "/leave",
        })
        persistApproval(approval)
        continue
      }
      approval.status = "APPROVED"
      approval.decidedBy = "system"
      approval.remarks = `Auto-approved after ${store.settings.approvalEscalateAfterDays} day(s) without a decision`
      applyApproval(store, approval)
      autoApproved += 1
      notify({
        employeeId: approval.employeeId,
        kind: "APPROVAL_ESCALATED",
        title: "Request auto-approved",
        body: `${approval.subject} — nobody decided it within ${store.settings.approvalEscalateAfterDays} day(s).`,
        href: "/leave",
      })
    } else {
      // Tell HR, and tell the person still waiting.
      for (const user of store.users) {
        if (store.matrix["leave.approve"]?.[user.role] !== "ALL") continue
        if (user.employeeId === approval.employeeId) continue
        notify({
          employeeId: user.employeeId,
          kind: "APPROVAL_ESCALATED",
          title: "Escalated to you",
          body: `${approval.subject} — waiting ${store.settings.approvalEscalateAfterDays}+ day(s) at L1.`,
          href: "/approvals",
        })
      }
      notify({
        employeeId: approval.employeeId,
        kind: "APPROVAL_ESCALATED",
        title: "Your request was escalated",
        body: `${approval.subject} — it has moved to HR for a decision.`,
        href: "/leave",
      })
    }
    persistApproval(approval)
  }
  return { escalated, autoApproved }
}
