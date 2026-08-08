import { regularisationPunches, reduceLedger } from "@attendance/shared"

import { persistLedgerEntry, persistPunch } from "./repositories"
import { id, type Store, type StoredApproval } from "./store"

/**
 * What approving a request actually *does*, in one place.
 *
 * This existed only inside the decide route, so the nightly escalation sweep's
 * auto-approve path set `status = "APPROVED"` and performed none of it: leave
 * was granted without ever debiting the ledger (a free day, and a balance that
 * stayed wrong forever), a comp-off claim was approved without crediting
 * anything, and a regularisation was approved without writing the punches that
 * are the entire point of it.
 *
 * Two callers, one implementation — an approval means the same thing however it
 * was reached.
 */

export type ApplyRefusal =
  | { ok: false; reason: "INSUFFICIENT_BALANCE"; detail: string }
  | { ok: false; reason: "UNKNOWN_SHIFT"; detail: string }

export type ApplyResult = { ok: true } | ApplyRefusal

const balanceOf = (store: Store, employeeId: string, type: string): number =>
  reduceLedger(
    store.ledger
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({ type: row.type, units: row.units }))
  )[type] ?? 0

/**
 * Can this approval be applied right now? Checked separately so a caller can
 * refuse *before* flipping the status — half-applied approvals are how ledgers
 * end up inconsistent.
 */
export function canApplyApproval(store: Store, approval: StoredApproval): ApplyResult {
  if (approval.kind === "LEAVE" && approval.leaveType && approval.leaveType !== "LOP") {
    const available = balanceOf(store, approval.employeeId, approval.leaveType)
    if (approval.units > available) {
      return {
        ok: false,
        reason: "INSUFFICIENT_BALANCE",
        detail: `${approval.leaveType}: ${available} available, ${approval.units} requested. Balance changed since the request was raised.`,
      }
    }
  }

  if (approval.kind === "REGULARISATION" && approval.regularisation) {
    const employee = store.employees.find((row) => row.id === approval.employeeId)
    const shift = employee
      ? store.shifts.find((candidate) => candidate.id === employee.shiftId)
      : undefined
    if (!shift) {
      return {
        ok: false,
        reason: "UNKNOWN_SHIFT",
        detail: `${approval.employeeId} has no resolvable shift, so the corrected day cannot be computed.`,
      }
    }
  }

  return { ok: true }
}

/**
 * Write the consequences of an approval. Call only after `canApplyApproval`
 * returned ok, and only once — every write here is idempotent on a re-run
 * except the ledger rows, which the caller guards by refusing to decide an
 * approval that is no longer PENDING.
 */
export function applyApproval(store: Store, approval: StoredApproval): void {
  if (approval.status !== "APPROVED") return

  if (approval.kind === "REGULARISATION" && approval.regularisation) {
    const employee = store.employees.find((row) => row.id === approval.employeeId)
    const shift = employee
      ? store.shifts.find((candidate) => candidate.id === employee.shiftId)
      : undefined
    if (!shift) return

    for (const punch of regularisationPunches(
      {
        date: approval.dateFrom,
        reason: approval.regularisation.reason,
        inTime: approval.regularisation.inTime,
        outTime: approval.regularisation.outTime,
        note: approval.detail,
      },
      shift.startMin
    )) {
      const stored = {
        id: id(store, "p"),
        employeeId: approval.employeeId,
        type: punch.type,
        businessDate: approval.dateFrom,
        offsetMin: punch.offsetMin,
        at: `${approval.dateFrom}T${punch.clock}`,
        accuracyM: 0,
        dayPart: "FULL" as const,
        flags: ["REGULARISED" as const],
        // Deterministic, so a replayed decision cannot double-write.
        idempotencyKey: `reg_${approval.id}_${punch.type}`,
      }
      if (store.punches.some((existing) => existing.idempotencyKey === stored.idempotencyKey))
        continue
      store.punches.push(stored)
      persistPunch(stored)
    }
    return
  }

  if (approval.kind === "COMP_OFF") {
    store.ledger.push({
      id: id(store, "l"),
      employeeId: approval.employeeId,
      type: "COMP_OFF",
      txnType: "COMP_OFF_CREDIT",
      units: approval.units,
      // Dated the day that was worked: expiry counts from there.
      date: approval.dateFrom,
      remarks: `${approval.id} approved — worked ${approval.dateFrom}`,
    })
    persistLedgerEntry(store.ledger.at(-1)!)
    return
  }

  if (approval.kind === "LEAVE" && approval.leaveType) {
    store.ledger.push({
      id: id(store, "l"),
      employeeId: approval.employeeId,
      type: approval.leaveType,
      txnType: "AVAIL",
      units: -approval.units,
      date: approval.dateFrom,
      remarks: `${approval.id} approved`,
    })
    persistLedgerEntry(store.ledger.at(-1)!)
  }
}
