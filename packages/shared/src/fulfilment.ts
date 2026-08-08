import * as z from "zod"

import type { Challan, SalesOrder } from "./sales"
import { soFulfilment } from "./sales"

/**
 * From an order to a signature on a delivery.
 *
 * Tally knows the order and the invoice. It has no opinion about the hours in
 * between — who walked the aisles, what went into which carton, which lorry it
 * left on, and whether anybody ever confirmed it arrived. That gap is where
 * goods are lost, and it is the reason this layer exists.
 *
 * The chain is: pick → pack → dispatch → proof of delivery. Each step names a
 * person and a time, because "the material was sent" is not a fact anybody can
 * act on and "Ramesh loaded it onto MH-12-AB-1234 at 16:40, LR 44821" is.
 */

/* ------------------------------------------------------------------ picking */

export const PICK_STATUS = ["PENDING", "PICKING", "PICKED", "SHORT", "CANCELLED"] as const
export const pickStatusSchema = z.enum(PICK_STATUS)
export type PickStatus = z.infer<typeof pickStatusSchema>

export const pickLineSchema = z.object({
  soLineId: z.string(),
  itemId: z.string(),
  /** What this list asks the picker for. */
  requestedQty: z.number().positive(),
  /** What was actually found. Zero until the picker walks it. */
  pickedQty: z.number().nonnegative().default(0),
  /** Where to find it. Free text — a rack label, not a foreign key. */
  location: z.string().default(""),
  /** Why less was picked than asked for. Required by validatePick when short. */
  shortReason: z.string().default(""),
})
export type PickLine = z.infer<typeof pickLineSchema>

export const pickListSchema = z.object({
  id: z.string(),
  /** PL-2026-0001. */
  number: z.string(),
  soId: z.string(),
  /** The picker this is assigned to. Unassigned lists are nobody's job. */
  assignedTo: z.string().nullable().default(null),
  status: pickStatusSchema,
  createdAt: z.string(),
  /** When the picker started walking, and when they finished. */
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  lines: z.array(pickLineSchema).min(1),
  notes: z.string().default(""),
})
export type PickList = z.infer<typeof pickListSchema>

/** A list still holding stock: not cancelled, not yet superseded by dispatch. */
const isActivePick = (pick: PickList) => pick.status !== "CANCELLED"

/**
 * How much of a line a new pick list may still ask for.
 *
 * Ordered, less what has already gone out, less what other open lists have
 * already claimed. Without the last term two pickers are sent for the same
 * carton and the second one finds an empty rack — a shortage the system caused.
 */
export function pickableQty(
  so: Pick<SalesOrder, "id" | "lines">,
  soLineId: string,
  challans: Challan[],
  picks: PickList[],
  /** A list being edited must not count itself as a competing claim. */
  excludePickId?: string
): number {
  const line = soFulfilment(so, challans).find((row) => row.soLineId === soLineId)
  if (!line) return 0

  const claimed = picks
    .filter((pick) => pick.soId === so.id && pick.id !== excludePickId && isActivePick(pick))
    .flatMap((pick) => pick.lines)
    .filter((pickLine) => pickLine.soLineId === soLineId)
    // A picker who has finished has the goods in hand; one who has not started
    // still holds the claim. Either way the stock is spoken for.
    .reduce((sum, pickLine) => sum + Math.max(pickLine.pickedQty, pickLine.requestedQty), 0)

  return Math.max(line.pendingQty - claimed, 0)
}

export interface FulfilmentIssue {
  field: string
  message: string
}

/**
 * Can this pick list be saved?
 *
 * Returns every problem at once. A picker holding a scanner should not have to
 * submit five times to learn five things.
 */
export function validatePick(input: {
  so: Pick<SalesOrder, "id" | "lines">
  pick: PickList
  challans: Challan[]
  otherPicks: PickList[]
}): FulfilmentIssue[] {
  const { so, pick, challans, otherPicks } = input
  const issues: FulfilmentIssue[] = []

  if (pick.soId !== so.id) issues.push({ field: "soId", message: "This list belongs to another order." })

  const known = new Set(so.lines.map((line) => line.id))
  for (const line of pick.lines) {
    if (!known.has(line.soLineId)) {
      issues.push({ field: line.soLineId, message: "That line is not on this order." })
      continue
    }

    const available = pickableQty(so, line.soLineId, challans, otherPicks, pick.id)
    if (line.requestedQty > available) {
      issues.push({
        field: line.soLineId,
        message:
          available === 0
            ? "Nothing left to pick on this line — it is already dispatched or claimed by another list."
            : `Only ${available} left to pick on this line; another list or a dispatch has the rest.`,
      })
    }

    if (line.pickedQty > line.requestedQty) {
      // Over-picking is how stock quietly leaves the building.
      issues.push({
        field: line.soLineId,
        message: `Picked ${line.pickedQty} against a request for ${line.requestedQty}. Raise the request instead.`,
      })
    }

    const isShort = pick.status !== "PENDING" && pick.status !== "PICKING" && line.pickedQty < line.requestedQty
    if (isShort && line.shortReason.trim().length === 0) {
      // A short pick with no reason becomes an argument at month end that
      // nobody can settle.
      issues.push({
        field: line.soLineId,
        message: "Say why this line is short — stock, damage, or wrong item.",
      })
    }
  }

  if (pick.status === "PICKED" && pick.lines.some((line) => line.pickedQty < line.requestedQty))
    issues.push({
      field: "status",
      message: "Some lines are short. Mark the list SHORT rather than PICKED.",
    })

  if (pick.status !== "PENDING" && !pick.assignedTo)
    issues.push({ field: "assignedTo", message: "A list being worked on must name its picker." })

  return issues
}

/* ------------------------------------------------------------------ packing */

export const packageSchema = z.object({
  /** Printed on the carton: 1 of 4. */
  sequence: z.number().int().positive(),
  description: z.string().default(""),
  weightKg: z.number().nonnegative().default(0),
  /** What went in, so a missing carton names the goods and not just a number. */
  contents: z.array(z.object({ soLineId: z.string(), qty: z.number().positive() })).default([]),
})
export type PackageUnit = z.infer<typeof packageSchema>

export const packSchema = z.object({
  id: z.string(),
  number: z.string(),
  pickListId: z.string(),
  soId: z.string(),
  packedBy: z.string(),
  packedAt: z.string(),
  packages: z.array(packageSchema).min(1),
  notes: z.string().default(""),
})
export type Pack = z.infer<typeof packSchema>

/** Total packed per order line, across every carton. */
export function packedQty(pack: Pick<Pack, "packages">, soLineId: string): number {
  return pack.packages
    .flatMap((unit) => unit.contents)
    .filter((entry) => entry.soLineId === soLineId)
    .reduce((sum, entry) => sum + entry.qty, 0)
}

/**
 * Packing may only contain what was picked.
 *
 * The seal on the carton is the last moment anybody counts. A pack that claims
 * more than the picker found produces a short delivery the customer discovers
 * and we cannot explain.
 */
export function validatePack(input: { pack: Pack; pick: PickList }): FulfilmentIssue[] {
  const { pack, pick } = input
  const issues: FulfilmentIssue[] = []

  if (pack.pickListId !== pick.id)
    issues.push({ field: "pickListId", message: "That pick list belongs to another pack." })

  if (pick.status === "PENDING" || pick.status === "PICKING")
    issues.push({ field: "pickListId", message: "Finish picking before packing." })
  if (pick.status === "CANCELLED")
    issues.push({ field: "pickListId", message: "That pick list was cancelled." })

  for (const line of pick.lines) {
    const packed = packedQty(pack, line.soLineId)
    if (packed > line.pickedQty)
      issues.push({
        field: line.soLineId,
        message: `Packed ${packed} but only ${line.pickedQty} was picked.`,
      })
  }

  const strays = new Set(
    pack.packages
      .flatMap((unit) => unit.contents)
      .map((entry) => entry.soLineId)
      .filter((id) => !pick.lines.some((line) => line.soLineId === id))
  )
  for (const id of strays)
    issues.push({ field: id, message: "That line was not on the pick list for this pack." })

  const sequences = pack.packages.map((unit) => unit.sequence)
  if (new Set(sequences).size !== sequences.length)
    issues.push({ field: "packages", message: "Two cartons carry the same number." })

  return issues
}

/* ---------------------------------------------------------------- dispatch */

/** Who pays the lorry. Printed on the LR and it decides who chases the bill. */
export const FREIGHT_TERMS = ["PAID", "TO_PAY", "BILLED_TO_CUSTOMER"] as const
export const freightTermsSchema = z.enum(FREIGHT_TERMS)
export type FreightTerms = z.infer<typeof freightTermsSchema>

/**
 * A Lorry Receipt is issued in three parts and each one goes somewhere else.
 * Filing "the LR" as a single scan is how the consignee copy goes missing and a
 * claim against the transporter fails months later.
 */
export const LR_COPIES = ["CONSIGNOR", "CONSIGNEE", "TRANSPORTER"] as const
export const lrCopySchema = z.enum(LR_COPIES)
export type LrCopy = z.infer<typeof lrCopySchema>

export const LR_COPY_LABEL: Record<LrCopy, string> = {
  CONSIGNOR: "Consignor copy (ours)",
  CONSIGNEE: "Consignee copy (customer's)",
  TRANSPORTER: "Transporter copy",
}

export const lrAttachmentSchema = z.object({
  copy: lrCopySchema,
  /** Where the scan lives. */
  url: z.string().min(1),
  uploadedBy: z.string().default(""),
  uploadedAt: z.string(),
})
export type LrAttachment = z.infer<typeof lrAttachmentSchema>

export const consignmentSchema = z.object({
  id: z.string(),
  /** DSP-2026-0001. */
  number: z.string(),
  soId: z.string(),
  /** The challan this consignment carries; goods out are recorded there. */
  challanId: z.string().nullable().default(null),
  packId: z.string().nullable().default(null),
  dispatchedAt: z.string(),
  dispatchedBy: z.string(),
  /** Blank means our own vehicle, which is why the LR rules relax. */
  transporterName: z.string().default(""),
  ownVehicle: z.boolean().default(false),
  lrNumber: z.string().default(""),
  lrDate: z.string().nullable().default(null),
  vehicleNo: z.string().default(""),
  driverName: z.string().default(""),
  driverPhone: z.string().default(""),
  freightPaise: z.number().int().nonnegative().default(0),
  freightTerms: freightTermsSchema.default("PAID"),
  /** E-way bill, where the consignment value requires one. */
  ewayBillNo: z.string().default(""),
  packageCount: z.number().int().nonnegative().default(0),
  weightKg: z.number().nonnegative().default(0),
  lrAttachments: z.array(lrAttachmentSchema).default([]),
  remarks: z.string().default(""),
})
export type Consignment = z.infer<typeof consignmentSchema>

/** Which LR copies are on file, and which are still missing. */
export function lrCopyStatus(consignment: Pick<Consignment, "lrAttachments" | "ownVehicle">): {
  held: LrCopy[]
  missing: LrCopy[]
  complete: boolean
} {
  // Our own lorry issues no LR, so there is nothing to be missing.
  if (consignment.ownVehicle) return { held: [], missing: [], complete: true }
  const held = LR_COPIES.filter((copy) =>
    consignment.lrAttachments.some((attachment) => attachment.copy === copy)
  )
  const missing = LR_COPIES.filter((copy) => !held.includes(copy))
  return { held: [...held], missing: [...missing], complete: missing.length === 0 }
}

export function validateConsignment(input: {
  consignment: Consignment
  /** Nothing may be dispatched that was not packed, when the company requires packing. */
  requirePack?: boolean
}): FulfilmentIssue[] {
  const { consignment, requirePack = false } = input
  const issues: FulfilmentIssue[] = []

  if (!consignment.ownVehicle) {
    if (consignment.transporterName.trim().length === 0)
      issues.push({ field: "transporterName", message: "Name the transporter, or mark it own vehicle." })
    if (consignment.lrNumber.trim().length === 0)
      // Without an LR number a claim against the transporter has nothing to
      // reference, and the goods are effectively untracked once they leave.
      issues.push({ field: "lrNumber", message: "An LR number is required unless this is our own vehicle." })
    if (!consignment.lrDate)
      issues.push({ field: "lrDate", message: "Record the LR date as printed on the receipt." })
  }

  if (consignment.vehicleNo.trim().length === 0)
    issues.push({ field: "vehicleNo", message: "Record the vehicle number." })

  if (requirePack && !consignment.packId)
    issues.push({ field: "packId", message: "This company dispatches only what has been packed." })

  if (consignment.lrDate && Date.parse(consignment.lrDate) > Date.parse(consignment.dispatchedAt)) {
    // An LR dated after the lorry left is a transcription error, and it breaks
    // every ageing report that keys off the LR date.
    issues.push({ field: "lrDate", message: "The LR cannot be dated after the dispatch." })
  }

  if (consignment.freightTerms === "TO_PAY" && consignment.freightPaise === 0)
    issues.push({
      field: "freightPaise",
      message: "To-pay freight with no amount leaves the customer nothing to pay against.",
    })

  return issues
}

/* -------------------------------------------------------- proof of delivery */

export const POD_CONDITION = ["OK", "SHORT", "DAMAGED", "REFUSED"] as const
export const podConditionSchema = z.enum(POD_CONDITION)
export type PodCondition = z.infer<typeof podConditionSchema>

export const podSchema = z.object({
  id: z.string(),
  consignmentId: z.string(),
  deliveredAt: z.string(),
  /** The person at the customer's gate who signed. A name, not a designation. */
  receivedBy: z.string().min(1),
  receiverPhone: z.string().default(""),
  condition: podConditionSchema,
  /** Per line, what actually arrived — a remark is not a quantity. */
  shortages: z
    .array(z.object({ soLineId: z.string(), qty: z.number().positive(), note: z.string().default("") }))
    .default([]),
  /** Signed LR, a photo at the gate, a stamped challan. */
  attachments: z.array(z.object({ url: z.string().min(1), label: z.string().default("") })).default([]),
  recordedBy: z.string().default(""),
  remarks: z.string().default(""),
})
export type ProofOfDelivery = z.infer<typeof podSchema>

export function validatePod(input: {
  pod: ProofOfDelivery
  consignment: Pick<Consignment, "id" | "dispatchedAt">
}): FulfilmentIssue[] {
  const { pod, consignment } = input
  const issues: FulfilmentIssue[] = []

  if (pod.consignmentId !== consignment.id)
    issues.push({ field: "consignmentId", message: "That delivery belongs to another dispatch." })

  const delivered = Date.parse(pod.deliveredAt)
  const dispatched = Date.parse(consignment.dispatchedAt)
  if (!Number.isFinite(delivered))
    issues.push({ field: "deliveredAt", message: "Record when it was delivered." })
  else if (delivered < dispatched)
    // Backdating a delivery before the lorry left hides a delay and corrupts
    // every transit-time figure built on it.
    issues.push({ field: "deliveredAt", message: "A delivery cannot predate the dispatch." })

  if ((pod.condition === "SHORT" || pod.condition === "DAMAGED") && pod.shortages.length === 0)
    issues.push({
      field: "shortages",
      message: "Record how much was short or damaged, line by line — a remark is not a quantity.",
    })

  if (pod.condition === "OK" && pod.shortages.length > 0)
    issues.push({ field: "condition", message: "Shortages are recorded, so this is not a clean delivery." })

  if (pod.condition === "REFUSED" && pod.remarks.trim().length === 0)
    issues.push({ field: "remarks", message: "Say why the delivery was refused." })

  return issues
}

/* ------------------------------------------------------------ where it is */

export const FULFILMENT_STAGES = [
  "ORDERED",
  "PICKING",
  "PACKED",
  "DISPATCHED",
  "DELIVERED",
  "EXCEPTION",
] as const
export type FulfilmentStage = (typeof FULFILMENT_STAGES)[number]

export interface FulfilmentView {
  stage: FulfilmentStage
  /** One line for a person who wants to know where the goods are. */
  summary: string
  /** Dispatches with no proof of delivery yet. */
  awaitingPod: string[]
  /** Dispatches missing at least one LR copy. */
  missingLrCopies: string[]
}

/**
 * Where an order actually is, derived rather than stored.
 *
 * A stored stage drifts the first time somebody records a step out of order,
 * and then the screen and the goods disagree. This reads the documents.
 */
export function fulfilmentView(input: {
  so: Pick<SalesOrder, "id" | "lines" | "status">
  challans: Challan[]
  picks: PickList[]
  packs: Pack[]
  consignments: Consignment[]
  pods: ProofOfDelivery[]
}): FulfilmentView {
  const { so, challans, picks, packs, consignments, pods } = input
  const ownPicks = picks.filter((pick) => pick.soId === so.id && isActivePick(pick))
  const ownPacks = packs.filter((pack) => pack.soId === so.id)
  const ownConsignments = consignments.filter((consignment) => consignment.soId === so.id)
  const podFor = new Set(pods.map((pod) => pod.consignmentId))

  const awaitingPod = ownConsignments.filter((row) => !podFor.has(row.id)).map((row) => row.id)
  const missingLrCopies = ownConsignments
    .filter((row) => !lrCopyStatus(row).complete)
    .map((row) => row.id)

  const exceptions = pods.filter(
    (pod) =>
      ownConsignments.some((row) => row.id === pod.consignmentId) &&
      pod.condition !== "OK"
  )

  const fulfilment = soFulfilment(so, challans)
  const fullyDispatched = fulfilment.every((line) => line.pendingQty === 0)

  if (exceptions.length > 0)
    return {
      stage: "EXCEPTION",
      summary:
        exceptions.length === 1
          ? "A delivery came back short, damaged or refused."
          : `${exceptions.length} deliveries came back short, damaged or refused.`,
      awaitingPod,
      missingLrCopies,
    }

  if (ownConsignments.length > 0 && awaitingPod.length === 0 && fullyDispatched)
    return { stage: "DELIVERED", summary: "Delivered and signed for.", awaitingPod, missingLrCopies }

  if (ownConsignments.length > 0)
    return {
      stage: "DISPATCHED",
      summary:
        awaitingPod.length > 0
          ? `${awaitingPod.length} dispatch(es) with no proof of delivery yet.`
          : "Dispatched; part of the order is still to go.",
      awaitingPod,
      missingLrCopies,
    }

  if (ownPacks.length > 0)
    return { stage: "PACKED", summary: "Packed and waiting for a vehicle.", awaitingPod, missingLrCopies }

  if (ownPicks.length > 0)
    return {
      stage: "PICKING",
      summary: ownPicks.every((pick) => pick.status === "PICKED" || pick.status === "SHORT")
        ? "Picked, not yet packed."
        : "With the picker.",
      awaitingPod,
      missingLrCopies,
    }

  return { stage: "ORDERED", summary: "Nothing picked yet.", awaitingPod, missingLrCopies }
}

/**
 * Dispatches that should have been signed for by now.
 *
 * An unacknowledged delivery is an unrecoverable claim: after a few weeks the
 * transporter is not liable and the customer does not remember. This is the
 * list somebody chases every morning.
 */
export function podOverdue(input: {
  consignments: Consignment[]
  pods: ProofOfDelivery[]
  asOfISO: string
  /** Days after dispatch before a missing POD is worth chasing. */
  graceDays: number
}): { consignmentId: string; number: string; daysOut: number }[] {
  const { consignments, pods, asOfISO, graceDays } = input
  const acknowledged = new Set(pods.map((pod) => pod.consignmentId))
  const asOf = Date.parse(asOfISO)
  if (!Number.isFinite(asOf)) return []

  return consignments
    .filter((consignment) => !acknowledged.has(consignment.id))
    .map((consignment) => ({
      consignmentId: consignment.id,
      number: consignment.number,
      daysOut: Math.floor((asOf - Date.parse(consignment.dispatchedAt)) / 86_400_000),
    }))
    .filter((row) => Number.isFinite(row.daysOut) && row.daysOut >= graceDays)
    .sort((a, b) => b.daysOut - a.daysOut)
}
