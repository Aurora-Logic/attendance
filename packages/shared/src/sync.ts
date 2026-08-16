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

// ------------------------------------------------------------ pull results

/**
 * What a pull job can be about. Free text on the wire and in the tables —
 * the column is text so a later phase attaches without a migration — but a
 * job the API enqueues names one of these, and the results endpoint only
 * ingests kinds it has a writer for.
 */
export const SYNC_ENTITY_TYPES = ['party', 'stock_item', 'price_list'] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/**
 * An exact decimal as text. Credit limits and opening balances are Tally's
 * figures held as a projection (D-01); a float would silently reshape them,
 * and a figure that no longer matches Tally to the paisa is the trust
 * failure REQ-S-05 reconciles against. Stored in `numeric` columns, never
 * computed on.
 */
const decimalString = z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/u, 'an exact decimal number');

/**
 * One party, as the agent read it out of Tally (REQ-R-01). The agent owns
 * the XML: it parses TallyPrime's export — malformed by strict standards,
 * which is why parsing happens where `fast-xml-parser` is — and posts rows
 * in this shape. The API never sees Tally XML on the pull path.
 */
export const partyPullRowSchema = z.object({
  guid: z.string().min(1).max(80),
  alterId: z.number().int().min(0),
  name: z.string().min(1).max(200),
  alias: z.string().min(1).max(200).optional(),
  /** Sundry Debtors / Sundry Creditors, verbatim from the parent group. */
  parentGroup: z.string().min(1).max(120),
  gstin: z.string().min(1).max(20).optional(),
  address: z.string().min(1).max(1000).optional(),
  creditLimit: decimalString.optional(),
  creditDays: z.number().int().min(0).max(3650).optional(),
  openingBalance: decimalString.optional(),
});

export type PartyPullRow = z.infer<typeof partyPullRowSchema>;

/** Chunk bounds: small enough to commit fast, large enough not to chatter. */
export const SYNC_CHUNK_MAX_ROWS = 500;

export const agentResultsSchema = z.object({
  agentInstanceId: agentInstanceIdSchema,
  /** Required on results: rows must come from the books they claim to. */
  openCompanyGuid: z.string().min(1).max(80),
  jobId: z.uuid(),
  entityType: z.literal('party'),
  rows: z.array(partyPullRowSchema).max(SYNC_CHUNK_MAX_ROWS),
  /**
   * REQ-Q-06: the journal keeps hashes of what was actually exchanged with
   * Tally, computed by the agent over the raw XML. The hash is the evidence;
   * the optional bodies are bulk the D-20 sweep clears after 30 days.
   */
  requestHash: z.string().min(1).max(128),
  responseHash: z.string().min(1).max(128),
  requestBody: z.string().max(512_000).optional(),
  responseBody: z.string().max(512_000).optional(),
  durationMs: z.number().int().min(0).optional(),
  /** True on the last chunk: the job completes and the cursor is final. */
  final: z.boolean(),
});

export type AgentResultsInput = z.infer<typeof agentResultsSchema>;

export interface AgentResultsAck {
  readonly jobId: string;
  readonly written: number;
  /** The cursor after this chunk committed — what the next pull filters above. */
  readonly lastAlterId: number;
  readonly jobState: 'CLAIMED' | 'DONE';
}

// ------------------------------------------------------------- exceptions

/**
 * Who raised the exception, which decides what "resolve" can mean (REQ-T-01).
 * An open set the way `entity_type` is: conflict (REQ-T-02) and drift
 * (REQ-T-08) producers arrive in later slices and add their kinds here.
 */
export const SYNC_EXCEPTION_KINDS = ['AGENT_ERROR', 'CONFLICT', 'REJECTION', 'DRIFT'] as const;

export type SyncExceptionKind = (typeof SYNC_EXCEPTION_KINDS)[number];

export const SYNC_EXCEPTION_STATES = ['OPEN', 'RESOLVED'] as const;

export type SyncExceptionState = (typeof SYNC_EXCEPTION_STATES)[number];

/**
 * The agent's failure report (09 §5). Deliberately *not* required to name the
 * open company: the error being reported may be exactly that the wrong books
 * are open, and a report the server refuses for describing the problem is a
 * report that never arrives.
 */
export const agentErrorSchema = z.object({
  agentInstanceId: agentInstanceIdSchema,
  /** The job that failed, when there was one; an errored heartbeat has none. */
  jobId: z.uuid().optional(),
  entityType: z.enum(SYNC_ENTITY_TYPES).optional(),
  /** The agent's own classification — HTTP status, Tally LINEERROR, timeout. */
  errorCode: z.string().trim().min(1).max(80).optional(),
  /** Tally's verbatim words. A paraphrase cannot be acted on (REQ-T-01). */
  errorText: z.string().trim().min(1).max(8_000),
  /** Same evidence rules as results: hashes prove, bodies expire (REQ-Q-06). */
  requestHash: z.string().min(1).max(128).optional(),
  responseHash: z.string().min(1).max(128).optional(),
  requestBody: z.string().max(512_000).optional(),
  responseBody: z.string().max(512_000).optional(),
  durationMs: z.number().int().min(0).optional(),
});

export type AgentErrorInput = z.infer<typeof agentErrorSchema>;

export interface AgentErrorAck {
  readonly exceptionId: string;
  /** Whether the named job was moved to FAILED by this report. */
  readonly jobFailed: boolean;
}

export interface SyncExceptionView {
  readonly id: string;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly kind: SyncExceptionKind;
  readonly entityType: string | null;
  readonly tallyError: string;
  readonly state: SyncExceptionState;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
}

/**
 * A resolution must say what was done. "Resolved" with no note is how the
 * same exception returns in a month with nobody remembering the first round.
 */
export const resolveSyncExceptionSchema = z.object({
  note: z.string().trim().min(3).max(2_000),
});

export type ResolveSyncExceptionInput = z.infer<typeof resolveSyncExceptionSchema>;

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
