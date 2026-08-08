/**
 * Leave maths. The ledger is the truth — balances are a projection of it, and
 * every rule here is a pure function so the API, the nightly accrual job and
 * the web preview cannot drift.
 */

export interface LedgerEntry {
  type: string
  units: number
}

/**
 * Project balances from the immutable ledger. Order-independent, and never
 * throws.
 *
 * It used to reject any *running* balance that went negative, which made the
 * result depend on traversal order. Rows carry business dates, not write
 * times — a comp-off credit is dated the day worked, a leave debit the day
 * taken — so a debit can legitimately precede its funding credit by date.
 * Boot hydration re-reads the ledger ordered by date, so after a restart that
 * employee's balance projection threw, and with it every route that reads a
 * balance: their leave list, their applications, and every approval decision
 * about them. Permanently, because the ledger is append-only and each route
 * that might repair it was itself broken.
 *
 * A projection is a summary of facts and has no business failing. Whether a
 * debit was *allowed* is a decision made before writing it — see
 * `overdrawnTypes` for detecting a ledger that got past that gate.
 */
export function reduceLedger(entries: LedgerEntry[]): Record<string, number> {
  const balances: Record<string, number> = {}
  for (const entry of entries) {
    balances[entry.type] = (balances[entry.type] ?? 0) + entry.units
  }
  // One rounding at the end: 0.5-unit half days must not drift over a year.
  for (const type of Object.keys(balances)) {
    balances[type] = Number(balances[type].toFixed(1))
  }
  return balances
}

/**
 * Types whose final balance is negative when policy forbids it — a ledger that
 * should not exist. Reported so it can be surfaced and repaired, rather than
 * throwing and taking every leave route down with it.
 */
export function overdrawnTypes(
  entries: LedgerEntry[],
  allowNegative: ReadonlySet<string> = new Set(["LOP"])
): string[] {
  return Object.entries(reduceLedger(entries))
    .filter(([type, balance]) => balance < 0 && !allowNegative.has(type))
    .map(([type]) => type)
}

export interface LeaveCalendar {
  isHoliday: (dateISO: string) => boolean
  isWeeklyOff: (dateISO: string) => boolean
}

const eachDate = (fromISO: string, toISO: string): string[] => {
  const out: string[] = []
  const cursor = new Date(`${fromISO}T00:00:00Z`)
  const end = new Date(`${toISO}T00:00:00Z`)
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

/**
 * How many leave units a from→to application consumes.
 *
 * Sandwich rule (§5): with it ON, a holiday/weekly-off is counted only when it
 * sits strictly BETWEEN two counted leave days — leave ending Friday does not
 * absorb the weekend, but Friday-to-Monday leave does.
 */
export function countLeaveUnits(
  fromISO: string,
  toISO: string,
  part: "FULL" | "FIRST_HALF" | "SECOND_HALF",
  calendar: LeaveCalendar,
  sandwich: boolean
): number {
  const dates = eachDate(fromISO, toISO)
  if (dates.length === 0) return 0
  if (dates.length === 1 && part !== "FULL") {
    return calendar.isHoliday(dates[0]) || calendar.isWeeklyOff(dates[0]) ? 0 : 0.5
  }

  const isWorking = (date: string) => !calendar.isHoliday(date) && !calendar.isWeeklyOff(date)
  let units = 0
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index]
    if (isWorking(date)) {
      units += 1
      continue
    }
    if (!sandwich) continue
    const hasWorkingBefore = dates.slice(0, index).some(isWorking)
    const hasWorkingAfter = dates.slice(index + 1).some(isWorking)
    if (hasWorkingBefore && hasWorkingAfter) units += 1
  }
  return units
}

/**
 * Pro-rata annual quota for a mid-year joiner (§5). The join month counts in
 * full when joining on or before the 15th — the conventional Indian HR rule.
 * Result is rounded to the nearest half day, since balances move in halves.
 */
export function prorateAnnualQuota(annualQuota: number, joinDateISO: string, year: number): number {
  const join = new Date(`${joinDateISO}T00:00:00Z`)
  if (join.getUTCFullYear() < year) return annualQuota
  if (join.getUTCFullYear() > year) return 0
  const startMonth = join.getUTCMonth() + (join.getUTCDate() <= 15 ? 0 : 1)
  const monthsRemaining = Math.max(12 - startMonth, 0)
  return Math.round((annualQuota * monthsRemaining) / 12 / 0.5) * 0.5
}

/** Comp-off earned on `earnedISO` is spendable until `expiryDays` later (§5). */
export function compOffUsable(earnedISO: string, expiryDays: number, onISO: string): boolean {
  const earned = new Date(`${earnedISO}T00:00:00Z`).getTime()
  const on = new Date(`${onISO}T00:00:00Z`).getTime()
  const diffDays = Math.floor((on - earned) / 86_400_000)
  return diffDays >= 0 && diffDays <= expiryDays
}

/* ------------------------------------------------------------- comp-off */

/**
 * What working an off-day earns. The same hour thresholds that decide a
 * normal day's payable units decide the credit, so "a full day is a full day"
 * means one thing across the system rather than two.
 */
export function compOffCredit(
  workedMinutes: number,
  settings: { halfDayMinHours: number; fullDayMinHours: number }
): number {
  if (workedMinutes >= settings.fullDayMinHours * 60) return 1
  if (workedMinutes >= settings.halfDayMinHours * 60) return 0.5
  return 0
}

export interface CompOffLot {
  /** Date the credit was earned — expiry counts from here. */
  earnedISO: string
  units: number
}

export interface CompOffExpiry {
  earnedISO: string
  units: number
}

/**
 * Which credits have gone stale. Credits are consumed **oldest first**, so a
 * debit always burns the credit closest to expiring — the arrangement that
 * loses the employee the least. Whatever is left un-consumed and past its
 * window is returned so the caller can write the expiry entries.
 *
 * Pure and FIFO, because an un-expiring credit is a liability that grows
 * forever, and expiring the wrong lot silently costs someone a day off.
 */
export function compOffExpiries(
  credits: CompOffLot[],
  debitUnits: number,
  expiryDays: number,
  todayISO: string
): CompOffExpiry[] {
  const ordered = [...credits].sort((a, b) => a.earnedISO.localeCompare(b.earnedISO))
  let remaining = debitUnits

  const expired: CompOffExpiry[] = []
  for (const lot of ordered) {
    const consumed = Math.min(remaining, lot.units)
    remaining -= consumed
    const left = lot.units - consumed
    if (left <= 0) continue
    if (!compOffUsable(lot.earnedISO, expiryDays, todayISO)) {
      expired.push({ earnedISO: lot.earnedISO, units: left })
    }
  }
  return expired
}

/* ------------------------------------------------------ the leave vocabulary */

/**
 * The leave type codes, in one place.
 *
 * They were duplicated: the web app offered `CO` for comp-off while the server
 * credited `COMP_OFF`. An employee could earn a comp-off day and then never
 * spend it — the balance was filed under one code and the application asked
 * for the other, so it was refused for insufficient balance against a balance
 * that was sitting right there.
 *
 * `LOP` is the only type allowed to go negative: it is unpaid by definition.
 */
export const LEAVE_TYPES = [
  { code: "CL", name: "Casual Leave", isPaid: true },
  { code: "SL", name: "Sick Leave", isPaid: true },
  { code: "EL", name: "Earned Leave", isPaid: true },
  { code: "COMP_OFF", name: "Comp-Off", isPaid: true },
  { code: "LOP", name: "Loss of Pay", isPaid: false },
] as const

export type LeaveTypeCode = (typeof LEAVE_TYPES)[number]["code"]

export const LEAVE_TYPE_CODES: readonly string[] = LEAVE_TYPES.map((type) => type.code)

export const isLeaveTypeCode = (value: string): value is LeaveTypeCode =>
  LEAVE_TYPE_CODES.includes(value)

export const leaveTypeName = (code: string): string =>
  LEAVE_TYPES.find((type) => type.code === code)?.name ?? code
