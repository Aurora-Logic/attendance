import * as z from "zod"

import { ageingBucket, type AgeingBucket } from "./billing"
import type { Paise } from "./money"

/**
 * Credit control.
 *
 * Tally records what is owed. It does not decide whether to let the next order
 * go out, and that decision — made at a counter, by somebody with a phone in
 * their hand — is where the money is actually lost.
 *
 * Nothing here sends anything. It produces the list and the verdict; who gets
 * told, and how, is a separate decision the owner has not made yet.
 */

/* ------------------------------------------------------------------- terms */

export const creditTermsSchema = z.object({
  /** Days from invoice date to due date. 0 means cash on delivery. */
  creditDays: z.number().int().nonnegative().default(30),
  /** Ceiling on total outstanding. 0 means no limit is enforced. */
  creditLimitPaise: z.number().int().nonnegative().default(0),
  /**
   * Days past due before new orders are held. Kept separate from creditDays so
   * a customer can be one day late without the counter stopping.
   */
  overdueGraceDays: z.number().int().nonnegative().default(7),
  /** Let a named approver release an order the rules would hold. */
  allowOverride: z.boolean().default(true),
})
export type CreditTerms = z.infer<typeof creditTermsSchema>

export const DEFAULT_CREDIT_TERMS: CreditTerms = {
  creditDays: 30,
  creditLimitPaise: 0,
  overdueGraceDays: 7,
  allowOverride: true,
}

/** Invoice date plus the credit period, as a plain ISO date. */
export function dueDateFor(invoiceDateISO: string, creditDays: number): string {
  const parsed = new Date(`${invoiceDateISO}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return invoiceDateISO
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(creditDays, 0))
  return parsed.toISOString().slice(0, 10)
}

/* --------------------------------------------------------------- exposure */

export interface OpenDoc {
  id: string
  number: string
  customerId: string
  dueDate: string
  outstandingPaise: Paise
}

export interface OverdueDoc extends OpenDoc {
  daysOverdue: number
  bucket: AgeingBucket
}

export interface CustomerExposure {
  customerId: string
  /** Everything unpaid, whether or not it is due yet. */
  outstandingPaise: Paise
  /** The part that is past its due date. */
  overduePaise: Paise
  /** The oldest unpaid document's age, which is what a credit call turns on. */
  oldestOverdueDays: number
  overdue: OverdueDoc[]
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`).getTime()
  const to = new Date(`${toISO}T00:00:00Z`).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

/**
 * What one customer owes, and how late.
 *
 * Documents with nothing outstanding are dropped rather than reported as zero:
 * a list padded with settled invoices is a list nobody reads.
 */
export function customerExposure(input: {
  customerId: string
  docs: OpenDoc[]
  todayISO: string
}): CustomerExposure {
  const { customerId, docs, todayISO } = input
  const own = docs.filter((doc) => doc.customerId === customerId && doc.outstandingPaise > 0)

  const overdue: OverdueDoc[] = own
    .filter((doc) => doc.dueDate < todayISO)
    .map((doc) => ({
      ...doc,
      daysOverdue: daysBetween(doc.dueDate, todayISO),
      bucket: ageingBucket(doc.dueDate, todayISO),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    customerId,
    outstandingPaise: own.reduce((sum, doc) => sum + doc.outstandingPaise, 0),
    overduePaise: overdue.reduce((sum, doc) => sum + doc.outstandingPaise, 0),
    oldestOverdueDays: overdue[0]?.daysOverdue ?? 0,
    overdue,
  }
}

/* ---------------------------------------------------------------- verdict */

export const CREDIT_VERDICTS = ["OK", "WARN", "HOLD"] as const
export type CreditVerdict = (typeof CREDIT_VERDICTS)[number]

export interface CreditDecision {
  verdict: CreditVerdict
  /** Said the way it would be said across a counter. */
  reason: string
  /** Whether a named approver may let it through anyway. */
  overridable: boolean
  /** Headroom left under the limit; negative means already past it. */
  headroomPaise: Paise | null
}

/**
 * Should this order go out?
 *
 * Two independent reasons to stop — too old, or too much — and they are kept
 * apart because they need different conversations. A customer within their
 * limit but sixty days late is a collection problem; one who pays on time but
 * has hit the ceiling is a limit problem.
 *
 * WARN exists so the counter sees a problem coming rather than being refused
 * without notice on a Friday afternoon.
 */
export function creditDecision(input: {
  exposure: CustomerExposure
  terms: CreditTerms
  /** Value of the order being considered, if any. */
  orderValuePaise?: Paise
}): CreditDecision {
  const { exposure, terms } = input
  const orderValue = input.orderValuePaise ?? 0
  const headroom =
    terms.creditLimitPaise > 0
      ? terms.creditLimitPaise - (exposure.outstandingPaise + orderValue)
      : null

  if (exposure.oldestOverdueDays > terms.overdueGraceDays) {
    return {
      verdict: "HOLD",
      reason: `An invoice is ${exposure.oldestOverdueDays} days past due — ${
        exposure.oldestOverdueDays - terms.overdueGraceDays
      } beyond the ${terms.overdueGraceDays}-day grace.`,
      overridable: terms.allowOverride,
      headroomPaise: headroom,
    }
  }

  if (headroom !== null && headroom < 0) {
    return {
      verdict: "HOLD",
      reason: orderValue > 0
        ? "This order would take the account past its credit limit."
        : "The account is already past its credit limit.",
      overridable: terms.allowOverride,
      headroomPaise: headroom,
    }
  }

  if (exposure.oldestOverdueDays > 0)
    return {
      verdict: "WARN",
      reason: `An invoice is ${exposure.oldestOverdueDays} day(s) past due, still inside the ${terms.overdueGraceDays}-day grace.`,
      overridable: true,
      headroomPaise: headroom,
    }

  // Ten per cent of the limit left is close enough to say so before the order
  // that crosses it is the one that gets refused.
  if (headroom !== null && headroom < terms.creditLimitPaise * 0.1)
    return {
      verdict: "WARN",
      reason: "Close to the credit limit.",
      overridable: true,
      headroomPaise: headroom,
    }

  return { verdict: "OK", reason: "Within terms.", overridable: true, headroomPaise: headroom }
}

/* ------------------------------------------------------- the chase list */

export interface OverdueRow {
  customerId: string
  customerName: string
  overduePaise: Paise
  oldestOverdueDays: number
  /** The single oldest document, which is what a call opens with. */
  oldestDocNumber: string
  bucket: AgeingBucket
  docCount: number
}

/**
 * Everyone worth ringing this morning, worst first.
 *
 * Sorted by age rather than amount on purpose: a small invoice ninety days old
 * is closer to being written off than a large one that fell due last week.
 */
export function overdueList(input: {
  docs: OpenDoc[]
  customers: { id: string; name: string }[]
  todayISO: string
  /** Ignore anything below this — chasing ₹40 costs more than ₹40. */
  minimumPaise?: Paise
}): OverdueRow[] {
  const { docs, customers, todayISO } = input
  const minimum = input.minimumPaise ?? 0

  return customers
    .map((customer) => {
      const exposure = customerExposure({ customerId: customer.id, docs, todayISO })
      const oldest = exposure.overdue[0]
      if (!oldest || exposure.overduePaise < minimum) return null
      return {
        customerId: customer.id,
        customerName: customer.name,
        overduePaise: exposure.overduePaise,
        oldestOverdueDays: exposure.oldestOverdueDays,
        oldestDocNumber: oldest.number,
        bucket: oldest.bucket,
        docCount: exposure.overdue.length,
      }
    })
    .filter((row): row is OverdueRow => row !== null)
    .sort(
      (a, b) => b.oldestOverdueDays - a.oldestOverdueDays || b.overduePaise - a.overduePaise
    )
}
