import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  consignmentSchema,
  formatDocNumber,
  fulfilmentView,
  lrCopySchema,
  lrCopyStatus,
  packSchema,
  pickableQty,
  pickListSchema,
  podOverdue,
  podSchema,
  validateConsignment,
  validatePack,
  validatePick,
  validatePod,
  type Consignment,
  type Pack,
  type PickList,
  type ProofOfDelivery,
} from "@attendance/shared"

import { recordAudit } from "./db"
import { id, type Store } from "./store"

/**
 * Getting goods from an order to a signature.
 *
 * Thin handlers over the shared rules, as everywhere else: every refusal in
 * this file comes from a pure function that is tested on its own, so the same
 * answer is given whether the request arrives from the picker's phone, the
 * dispatch desk, or a script.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

const REFUSED = (issues: { field: string; message: string }[]) => ({
  error: "RULES_REFUSED",
  issues,
})

export function registerFulfilmentRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards

  const canView = [authenticate, requirePermission("dispatch.view")]
  const canPick = [authenticate, requirePermission("dispatch.pick", { write: true })]
  const canDispatch = [authenticate, requirePermission("dispatch.manage", { write: true })]

  const soOr404 = (soId: string, reply: FastifyReply) => {
    const so = store.salesOrders.find((order) => order.id === soId)
    if (!so) {
      void reply.code(404).send({ error: "SO_NOT_FOUND" })
      return null
    }
    return so
  }

  const year = () => new Date().getUTCFullYear()

  /* ------------------------------------------------------------- the board */

  /**
   * Where every open order is. This is the screen somebody stands in front of
   * in the morning, so it answers "what is stuck" rather than listing rows.
   */
  app.get("/fulfilment", { preHandler: canView }, async () => {
    const open = store.salesOrders.filter((so) => so.status === "OPEN")
    const orders = open.map((so) => ({
      soId: so.id,
      number: so.number,
      customerId: so.customerId,
      orderDate: so.orderDate,
      ...fulfilmentView({
        so,
        challans: store.challans,
        picks: store.pickLists,
        packs: store.packs,
        consignments: store.consignments,
        pods: store.pods,
      }),
    }))

    return {
      orders,
      /** Dispatches nobody has signed for, past the company's grace period. */
      podOverdue: podOverdue({
        consignments: store.consignments,
        pods: store.pods,
        asOfISO: new Date().toISOString(),
        graceDays: store.operations.dispatch.podGraceDays,
      }),
      /** Dispatches missing at least one lorry-receipt copy. */
      missingLrCopies: store.consignments
        .map((consignment) => ({ consignment, status: lrCopyStatus(consignment) }))
        .filter((row) => !row.status.complete)
        .map((row) => ({
          consignmentId: row.consignment.id,
          number: row.consignment.number,
          missing: row.status.missing,
        })),
    }
  })

  /* ------------------------------------------------------------- picking */

  app.get("/fulfilment/picks", { preHandler: canView }, async (request) => {
    const query = request.query as { soId?: string; mine?: string }
    const mine = query.mine === "true" ? request.auth.employeeId : null
    return {
      picks: store.pickLists.filter(
        (pick) =>
          (!query.soId || pick.soId === query.soId) && (!mine || pick.assignedTo === mine)
      ),
    }
  })

  /** What a new list may still ask for, line by line. */
  app.get("/fulfilment/picks/available/:soId", { preHandler: canView }, async (request, reply) => {
    const so = soOr404((request.params as { soId: string }).soId, reply)
    if (!so) return
    return {
      lines: so.lines.map((line) => ({
        soLineId: line.id,
        itemId: line.itemId,
        orderedQty: line.qty,
        pickableQty: pickableQty(so, line.id, store.challans, store.pickLists),
      })),
    }
  })

  const createPickBody = z.object({
    soId: z.string(),
    assignedTo: z.string().nullable().default(null),
    lines: z
      .array(
        z.object({
          soLineId: z.string(),
          requestedQty: z.number().positive(),
          location: z.string().default(""),
        })
      )
      .min(1),
    notes: z.string().default(""),
  })

  app.post("/fulfilment/picks", { preHandler: canPick }, async (request, reply) => {
    const parsed = createPickBody.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = soOr404(parsed.data.soId, reply)
    if (!so) return

    const known = new Map(so.lines.map((line) => [line.id, line]))
    const pick: PickList = {
      id: id(store, "pick"),
      number: formatDocNumber("PL", year(), ++store.seq.pick),
      soId: so.id,
      assignedTo: parsed.data.assignedTo,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      lines: parsed.data.lines.map((line) => ({
        soLineId: line.soLineId,
        itemId: known.get(line.soLineId)?.itemId ?? "",
        requestedQty: line.requestedQty,
        pickedQty: 0,
        location: line.location,
        shortReason: "",
      })),
      notes: parsed.data.notes,
    }

    const issues = validatePick({
      so,
      pick,
      challans: store.challans,
      otherPicks: store.pickLists,
    })
    if (issues.length > 0) return reply.code(422).send(REFUSED(issues))

    store.pickLists.push(pick)
    recordAudit({
      actorId: request.auth.userId,
      action: "fulfilment.pick_created",
      entity: "pick_lists",
      entityId: pick.id,
      after: { number: pick.number, soId: pick.soId, lines: pick.lines.length },
      ip: request.ip,
    })
    return reply.code(201).send({ pick })
  })

  const updatePickBody = z.object({
    assignedTo: z.string().nullable().optional(),
    status: pickListSchema.shape.status.optional(),
    notes: z.string().optional(),
    lines: z
      .array(
        z.object({
          soLineId: z.string(),
          pickedQty: z.number().nonnegative().optional(),
          location: z.string().optional(),
          shortReason: z.string().optional(),
        })
      )
      .optional(),
  })

  app.patch("/fulfilment/picks/:id", { preHandler: canPick }, async (request, reply) => {
    const existing = store.pickLists.find(
      (pick) => pick.id === (request.params as { id: string }).id
    )
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND" })
    if (existing.status === "CANCELLED")
      return reply.code(409).send({ error: "CANCELLED", message: "That list was cancelled." })

    const parsed = updatePickBody.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = soOr404(existing.soId, reply)
    if (!so) return

    /**
     * Validated on a copy. Writing first and rolling back on failure is how a
     * half-applied update survives a refusal — a picker would see a quantity
     * the rules rejected.
     */
    const draft: PickList = structuredClone(existing)
    if (parsed.data.assignedTo !== undefined) draft.assignedTo = parsed.data.assignedTo
    if (parsed.data.notes !== undefined) draft.notes = parsed.data.notes
    for (const patch of parsed.data.lines ?? []) {
      const line = draft.lines.find((row) => row.soLineId === patch.soLineId)
      if (!line) return reply.code(400).send({ error: "UNKNOWN_LINE", soLineId: patch.soLineId })
      if (patch.pickedQty !== undefined) line.pickedQty = patch.pickedQty
      if (patch.location !== undefined) line.location = patch.location
      if (patch.shortReason !== undefined) line.shortReason = patch.shortReason
    }
    if (parsed.data.status !== undefined) {
      draft.status = parsed.data.status
      if (draft.status === "PICKING" && !draft.startedAt) draft.startedAt = new Date().toISOString()
      if (draft.status === "PICKED" || draft.status === "SHORT")
        draft.completedAt = new Date().toISOString()
    }

    const issues = validatePick({
      so,
      pick: draft,
      challans: store.challans,
      otherPicks: store.pickLists.filter((pick) => pick.id !== draft.id),
    })
    if (issues.length > 0) return reply.code(422).send(REFUSED(issues))

    Object.assign(existing, draft)
    recordAudit({
      actorId: request.auth.userId,
      action: "fulfilment.pick_updated",
      entity: "pick_lists",
      entityId: existing.id,
      after: { status: existing.status, lines: existing.lines },
      ip: request.ip,
    })
    return { pick: existing }
  })

  /* ------------------------------------------------------------- packing */

  const createPackBody = z.object({
    pickListId: z.string(),
    packages: packSchema.shape.packages,
    notes: z.string().default(""),
  })

  app.post("/fulfilment/packs", { preHandler: canPick }, async (request, reply) => {
    const parsed = createPackBody.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })

    const pick = store.pickLists.find((row) => row.id === parsed.data.pickListId)
    if (!pick) return reply.code(404).send({ error: "PICK_NOT_FOUND" })

    const pack: Pack = {
      id: id(store, "pack"),
      number: formatDocNumber("PK", year(), ++store.seq.pack),
      pickListId: pick.id,
      soId: pick.soId,
      packedBy: request.auth.employeeId,
      packedAt: new Date().toISOString(),
      packages: parsed.data.packages,
      notes: parsed.data.notes,
    }

    const issues = validatePack({ pack, pick })
    if (issues.length > 0) return reply.code(422).send(REFUSED(issues))

    store.packs.push(pack)
    recordAudit({
      actorId: request.auth.userId,
      action: "fulfilment.packed",
      entity: "packs",
      entityId: pack.id,
      after: { number: pack.number, packages: pack.packages.length },
      ip: request.ip,
    })
    return reply.code(201).send({ pack })
  })

  app.get("/fulfilment/packs", { preHandler: canView }, async (request) => {
    const soId = (request.query as { soId?: string }).soId
    return { packs: store.packs.filter((pack) => !soId || pack.soId === soId) }
  })

  /* ------------------------------------------------------------ dispatch */

  const createConsignmentBody = consignmentSchema.omit({
    id: true,
    number: true,
    dispatchedBy: true,
    lrAttachments: true,
  })

  app.post("/fulfilment/consignments", { preHandler: canDispatch }, async (request, reply) => {
    const parsed = createConsignmentBody.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = soOr404(parsed.data.soId, reply)
    if (!so) return

    const rules = store.operations.dispatch
    const consignment: Consignment = {
      ...parsed.data,
      id: id(store, "cnsg"),
      number: formatDocNumber("DSP", year(), ++store.seq.dsp),
      dispatchedBy: request.auth.employeeId,
      lrAttachments: [],
      /**
       * A vehicle the company owns needs no lorry receipt, and asking for one
       * trains people to type a fake number — which is worse than not asking.
       */
      ownVehicle:
        parsed.data.ownVehicle || rules.ownVehicleNumbers.includes(parsed.data.vehicleNo.trim()),
    }

    const issues = validateConsignment({
      consignment,
      requirePack: rules.requirePacking,
    })
    // A company that has switched the LR rule off gets no LR complaints.
    const filtered = rules.requireLrNumber
      ? issues
      : issues.filter((issue) => issue.field !== "lrNumber" && issue.field !== "lrDate")
    if (filtered.length > 0) return reply.code(422).send(REFUSED(filtered))

    if (rules.requirePickList && !store.pickLists.some((pick) => pick.soId === so.id))
      return reply.code(422).send(
        REFUSED([{ field: "soId", message: "Nothing leaves that was not picked." }])
      )

    if (
      rules.ewayBillThresholdPaise > 0 &&
      consignment.freightPaise > rules.ewayBillThresholdPaise &&
      consignment.ewayBillNo.trim().length === 0
    )
      return reply
        .code(422)
        .send(REFUSED([{ field: "ewayBillNo", message: "This consignment needs an e-way bill number." }]))

    store.consignments.push(consignment)
    recordAudit({
      actorId: request.auth.userId,
      action: "fulfilment.dispatched",
      entity: "consignments",
      entityId: consignment.id,
      after: {
        number: consignment.number,
        lrNumber: consignment.lrNumber,
        vehicleNo: consignment.vehicleNo,
      },
      ip: request.ip,
    })
    return reply.code(201).send({ consignment })
  })

  app.get("/fulfilment/consignments", { preHandler: canView }, async (request) => {
    const soId = (request.query as { soId?: string }).soId
    return {
      consignments: store.consignments
        .filter((consignment) => !soId || consignment.soId === soId)
        .map((consignment) => ({
          ...consignment,
          lr: lrCopyStatus(consignment),
          pod: store.pods.find((pod) => pod.consignmentId === consignment.id) ?? null,
        })),
    }
  })

  /** Attaching one of the three lorry-receipt copies. */
  app.post(
    "/fulfilment/consignments/:id/lr-copies",
    { preHandler: canDispatch },
    async (request, reply) => {
      const consignment = store.consignments.find(
        (row) => row.id === (request.params as { id: string }).id
      )
      if (!consignment) return reply.code(404).send({ error: "NOT_FOUND" })

      const parsed = z
        .object({ copy: lrCopySchema, url: z.string().min(1) })
        .safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })

      // Replacing rather than appending: a second scan of the consignee copy is
      // a better scan, not a second copy, and appending would make the "all
      // three on file" check pass on three scans of the same sheet.
      consignment.lrAttachments = [
        ...consignment.lrAttachments.filter((row) => row.copy !== parsed.data.copy),
        {
          copy: parsed.data.copy,
          url: parsed.data.url,
          uploadedBy: request.auth.employeeId,
          uploadedAt: new Date().toISOString(),
        },
      ]

      recordAudit({
        actorId: request.auth.userId,
        action: "fulfilment.lr_copy_attached",
        entity: "consignments",
        entityId: consignment.id,
        after: { copy: parsed.data.copy },
        ip: request.ip,
      })
      return { consignment, lr: lrCopyStatus(consignment) }
    }
  )

  /* --------------------------------------------------- proof of delivery */

  const podBody = podSchema.omit({ id: true, recordedBy: true })

  app.post("/fulfilment/pods", { preHandler: canDispatch }, async (request, reply) => {
    const parsed = podBody.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })

    const consignment = store.consignments.find((row) => row.id === parsed.data.consignmentId)
    if (!consignment) return reply.code(404).send({ error: "CONSIGNMENT_NOT_FOUND" })

    if (store.pods.some((pod) => pod.consignmentId === consignment.id))
      // A second proof against one dispatch means one of them is wrong, and
      // whichever arrived second would quietly bury the first.
      return reply.code(409).send({ error: "ALREADY_ACKNOWLEDGED" })

    if (store.operations.dispatch.requireAllLrCopies && !lrCopyStatus(consignment).complete)
      return reply.code(422).send(
        REFUSED([
          {
            field: "consignmentId",
            message: `Attach the missing lorry-receipt copies first: ${lrCopyStatus(consignment).missing.join(", ")}.`,
          },
        ])
      )

    const pod: ProofOfDelivery = {
      ...parsed.data,
      id: id(store, "pod"),
      recordedBy: request.auth.employeeId,
    }

    const issues = validatePod({ pod, consignment })
    if (issues.length > 0) return reply.code(422).send(REFUSED(issues))

    store.pods.push(pod)
    recordAudit({
      actorId: request.auth.userId,
      action: "fulfilment.delivered",
      entity: "pods",
      entityId: pod.id,
      after: {
        consignment: consignment.number,
        receivedBy: pod.receivedBy,
        condition: pod.condition,
      },
      ip: request.ip,
    })
    return reply.code(201).send({ pod })
  })
}
