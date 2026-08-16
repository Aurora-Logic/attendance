import { z } from 'zod';

/**
 * The connector agent's wire contract (REQ-Q-01 … Q-05, 09 §5).
 *
 * The agent authenticates with a per-connection credential, never a user
 * token, and holds nothing beyond its own connection. These shapes are shared
 * so the agent binary (Phase 6b, its own build) compiles against the same
 * contract the API enforces.
 */

/**
 * REQ-Q-05: the agent reports the *specific* condition, because "Tally is not
 * running" and "Tally is running with the wrong company open" are different
 * problems with different fixes. The server stores the effective condition on
 * the connection, so an administrator looking at an ERROR knows which problem
 * it is — and it derives `WRONG_COMPANY_OPEN` itself from the reported
 * company GUID, so a confused agent cannot call the wrong books "OK".
 */
export const AGENT_CONDITIONS = [
  'OK',
  'TALLY_NOT_RUNNING',
  'WRONG_COMPANY_OPEN',
  'LICENCE_LAPSED',
] as const;

export type AgentCondition = (typeof AGENT_CONDITIONS)[number];

/**
 * One agent per company, enforced by a lease (09 §3.4). A dead agent must not
 * hold its lease forever, so a rival instance may take over once the current
 * holder's heartbeat is older than this.
 *
 * Five minutes is REQ-Q-04's number, and it is deliberately the single answer
 * to "when do we stop believing the agent is alive": the Integrations
 * screen's STALE label derives from this same constant, so a lease cannot
 * change hands while the screen still calls the connection healthy.
 */
export const AGENT_LEASE_TAKEOVER_MINUTES = 5;

/** Random per install; the lease is held by an instance, not a version. One
 * schema for both routes — the lease compares these values across them, so
 * two hand-copied bounds drifting apart would split one identity in two. */
const agentInstanceIdSchema = z.string().min(8).max(64);

export const agentHeartbeatSchema = z.object({
  agentInstanceId: agentInstanceIdSchema,
  agentVersion: z.string().min(1).max(40),
  tallyVersion: z.string().max(40).optional(),
  /**
   * The GUID of the company Tally actually has open, when Tally is
   * reachable. `min(1)` so "no company open" must be spelled by omission —
   * an empty string would read as a company that differs from every GUID,
   * turning "nothing is open" into "the wrong thing is open", which are
   * different problems with different fixes (REQ-Q-05).
   */
  openCompanyGuid: z.string().min(1).max(80).optional(),
  condition: z.enum(AGENT_CONDITIONS).default('OK'),
});

export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;

/**
 * No `leaseHeld` flag: a heartbeat that did not win the lease is a 409, so an
 * ack's existence already carries that bit and a field could only ever be
 * true.
 */
export interface AgentHeartbeatAck {
  readonly connectionId: string;
  /** What the server expects open; null until an administrator binds one. */
  readonly companyGuid: string | null;
  /** The condition the server recorded — the agent's report, or the mismatch it derived. */
  readonly condition: AgentCondition;
  /** Echoed so agent and server cannot quietly disagree about the takeover rule. */
  readonly leaseTakeoverMinutes: number;
}

export const agentClaimSchema = z.object({
  agentInstanceId: agentInstanceIdSchema,
  openCompanyGuid: z.string().min(1).max(80).optional(),
});

export type AgentClaimInput = z.infer<typeof agentClaimSchema>;

export interface ClaimedSyncJob {
  readonly id: string;
  readonly direction: 'PULL' | 'PUSH';
  readonly entityType: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export interface AgentClaimResponse {
  /** Null when the queue is empty — the normal answer, not an error. */
  readonly job: ClaimedSyncJob | null;
}

// ---------------------------------------------------------- administration

export const createIntegrationConnectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Bound later if unknown at creation; jobs are refused until it is. */
  companyGuid: z.string().trim().min(1).max(80).optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
});

export type CreateIntegrationConnectionInput = z.infer<typeof createIntegrationConnectionSchema>;

export interface IssuedAgentToken {
  readonly connectionId: string;
  /**
   * Shown exactly once. Only its hash is stored, so there is no endpoint that
   * can show it again — reissue rotates it and the old one stops working.
   */
  readonly token: string;
}
