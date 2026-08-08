import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  agentHealth,
  reconcile,
  syncPushRequestSchema,
  tallyEntitySchema,
  type SyncConflict,
} from "@attendance/shared"

import { recordAudit } from "./db"
import { id, type Store, type StoredSyncRecord } from "./store"

/**
 * The connector's side of the Tally layer.
 *
 * These routes are called by an agent running on the Windows machine where
 * Tally lives, not by a person, so they authenticate with a shared secret
 * rather than a session cookie. Everything a human reads goes through the
 * session-authenticated status routes at the bottom.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

const IS_PRODUCTION = process.env.NODE_ENV === "production"

/**
 * The agent's credential. As with the JWT secret, production refuses to run on
 * a default: this endpoint accepts writes to the commercial masters, so an
 * unset secret would leave them open to anyone who can reach the host.
 */
function resolveAgentSecret(): string {
  const configured = process.env.TALLY_AGENT_SECRET
  if (IS_PRODUCTION) {
    if (!configured || configured.length < 32)
      throw new Error(
        "TALLY_AGENT_SECRET must be set to at least 32 characters in production. " +
          "Generate one with: openssl rand -base64 48"
      )
    return configured
  }
  return configured ?? "dev-only-tally-agent-secret"
}

const AGENT_SECRET = resolveAgentSecret()

const recordKey = (entity: string, guid: string) => `${entity}:${guid}`

export function registerTallyRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards

  /**
   * Constant-time-ish comparison on a shared secret. Length is checked first
   * so a mismatch cannot be found by timing the loop.
   */
  const authenticateAgent = async (request: FastifyRequest, reply: FastifyReply) => {
    const offered = request.headers["x-agent-secret"]
    if (typeof offered !== "string" || offered.length !== AGENT_SECRET.length) {
      return reply.code(401).send({ error: "AGENT_UNAUTHENTICATED" })
    }
    let diff = 0
    for (let index = 0; index < offered.length; index++) {
      diff |= offered.charCodeAt(index) ^ AGENT_SECRET.charCodeAt(index)
    }
    if (diff !== 0) return reply.code(401).send({ error: "AGENT_UNAUTHENTICATED" })
  }

  const touchAgent = (patch: Partial<Store["tallyAgent"]>) => {
    store.tallyAgent = {
      ...store.tallyAgent,
      ...patch,
      lastSeenAt: new Date().toISOString(),
    }
  }

  // ---- the agent's three routes -------------------------------------------

  app.post(
    "/tally/sync/heartbeat",
    { preHandler: [authenticateAgent] },
    async (request) => {
      const parsed = z
        .object({ agentVersion: z.string().default(""), company: z.string().default("") })
        .safeParse(request.body ?? {})
      touchAgent(parsed.success ? parsed.data : {})
      return { ok: true, staleAfterMs: 10 * 60 * 1000 }
    }
  )

  /**
   * The agent sends masters it saw change in Tally. Each is reconciled against
   * our copy; a conflict resolves by last-write-wins and the discarded copy is
   * kept so nothing vanishes silently.
   */
  app.post("/tally/sync/push", { preHandler: [authenticateAgent] }, async (request, reply) => {
    const parsed = syncPushRequestSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const { company, agentVersion, records } = parsed.data

    /**
     * A company mismatch means the agent is pointed at the wrong books. Merging
     * one company's masters into another's is not recoverable by a later sync,
     * so this refuses rather than guessing.
     */
    if (store.tallyAgent.company && store.tallyAgent.company !== company) {
      return reply.code(409).send({
        error: "COMPANY_MISMATCH",
        expected: store.tallyAgent.company,
        received: company,
      })
    }

    const summary = { pulled: 0, kept: 0, conflicts: 0 }
    const now = new Date().toISOString()

    for (const incoming of records) {
      const key = recordKey(incoming.entity, incoming.tallyGuid)
      const existing = store.tallyRecords.find(
        (candidate) => recordKey(candidate.entity, candidate.tallyGuid) === key
      )

      const decision = reconcile({
        app: existing ? { updatedAt: existing.updatedAt } : null,
        tally: { updatedAt: incoming.updatedAt, alterId: incoming.alterId },
        // The watermark, not the record's current state — see StoredSyncRecord.
        lastSynced: existing
          ? { updatedAt: existing.syncedUpdatedAt, alterId: existing.syncedAlterId }
          : null,
      })

      if (decision.action === "conflict") {
        summary.conflicts += 1
        const conflict: SyncConflict = {
          id: id(store, "cfl"),
          entity: incoming.entity,
          tallyGuid: incoming.tallyGuid,
          name: incoming.name,
          winner: decision.winner,
          reason: decision.reason,
          // Whatever loses is preserved verbatim, so it can be restored.
          discarded: decision.winner === "tally" ? (existing?.fields ?? {}) : incoming.fields,
          at: now,
          reviewedAt: null,
        }
        store.tallyConflicts.unshift(conflict)
        if (decision.winner === "app") {
          summary.kept += 1
          continue
        }
      } else if (decision.action === "push" || decision.action === "none") {
        summary.kept += 1
        continue
      }

      // pull, or a conflict Tally won. The watermark moves with the copy we
      // just accepted, so the next sync compares against this point.
      const next: StoredSyncRecord = {
        ...incoming,
        syncedUpdatedAt: incoming.updatedAt,
        syncedAlterId: incoming.alterId,
      }
      if (existing) Object.assign(existing, next)
      else store.tallyRecords.push(next)
      summary.pulled += 1
    }

    touchAgent({
      agentVersion,
      company,
      lastPushed: records.length,
    })
    recordAudit({
      actorId: "tally-agent",
      action: "tally.sync_push",
      entity: "tally_records",
      entityId: company,
      after: summary,
      ip: request.ip,
    })
    return { ...summary, received: records.length }
  })

  /**
   * What the agent should write into Tally. Only records this side changed
   * more recently than Tally's copy — the agent does not need our whole book.
   */
  app.get("/tally/sync/pull", { preHandler: [authenticateAgent] }, async (request) => {
    const entity = (request.query as { entity?: string }).entity
    const parsedEntity = entity ? tallyEntitySchema.safeParse(entity) : null

    const pending = store.tallyRecords.filter((record) => {
      if (parsedEntity?.success && record.entity !== parsedEntity.data) return false
      // `alterId === 0` marks a record this side created that Tally has never
      // seen; anything else is only pushed when we hold the newer edit.
      return record.alterId === 0
    })

    touchAgent({ lastPulled: pending.length })
    return { records: pending, count: pending.length }
  })

  // ---- what a person reads ------------------------------------------------

  app.get(
    "/tally/status",
    { preHandler: [authenticate, requirePermission("sales.view")] },
    async () => {
      const health = agentHealth(store.tallyAgent.lastSeenAt, new Date().toISOString())
      const byEntity: Record<string, number> = {}
      for (const record of store.tallyRecords) {
        byEntity[record.entity] = (byEntity[record.entity] ?? 0) + 1
      }
      return {
        agent: { ...store.tallyAgent, ...health },
        records: { total: store.tallyRecords.length, byEntity },
        conflicts: {
          total: store.tallyConflicts.length,
          unreviewed: store.tallyConflicts.filter((row) => row.reviewedAt === null).length,
        },
      }
    }
  )

  app.get(
    "/tally/conflicts",
    { preHandler: [authenticate, requirePermission("sales.view")] },
    async () => ({ conflicts: store.tallyConflicts.slice(0, 200) })
  )

  app.post(
    "/tally/conflicts/:id/reviewed",
    { preHandler: [authenticate, requirePermission("sales.manage", { write: true })] },
    async (request, reply) => {
      const conflict = store.tallyConflicts.find(
        (row) => row.id === (request.params as { id: string }).id
      )
      if (!conflict) return reply.code(404).send({ error: "NOT_FOUND" })
      conflict.reviewedAt = new Date().toISOString()
      recordAudit({
        actorId: request.auth.userId,
        action: "tally.conflict_reviewed",
        entity: "tally_conflicts",
        entityId: conflict.id,
        after: { entity: conflict.entity, name: conflict.name },
        ip: request.ip,
      })
      return { conflict }
    }
  )
}
