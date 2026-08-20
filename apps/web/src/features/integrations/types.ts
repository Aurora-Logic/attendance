import {
  AGENT_CONDITIONS,
  INTEGRATION_STATUSES,
  INTEGRATION_SYSTEMS,
  SYNC_EXCEPTION_KINDS,
  SYNC_EXCEPTION_STATES,
  type IntegrationStatus,
} from '@vyuha/shared';
import { z } from 'zod';

/**
 * `GET /integrations` (technical design §14), as this screen reads it.
 *
 * Mirrors the `integration_connections` columns that are safe to publish.
 * `agent_token_hash` is deliberately absent from this contract: it is a
 * credential, it is never returned, and a field declared here would be a
 * standing invitation for a future endpoint to fill it in.
 */

export const integrationConnectionSchema = z.object({
  id: z.string(),
  system: z.enum(INTEGRATION_SYSTEMS),
  name: z.string(),
  status: z.enum(INTEGRATION_STATUSES),
  /** ISO instant, or null when the agent has never reported in. */
  lastHeartbeatAt: z.string().nullable(),
  /** True when a token has been issued, never the token itself. */
  tokenIssued: z.boolean(),
  /** Which Tally company this connection is bound to (REQ-Q-03). */
  companyName: z.string().nullable(),
  /** REQ-Q-05: the specific problem the last heartbeat carried, so ERROR names its fix. */
  lastCondition: z.enum(AGENT_CONDITIONS).nullable(),
  /** Which door: a Vyuha agent token, an OpsTally webhook secret, or neither yet. */
  transport: z.enum(['unset', 'agent', 'webhook']),
  /** OpsTally's install id once the first verified delivery bound it. */
  webhookInstallId: z.string().nullable(),
});

export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;

export const integrationsResponseSchema = z.object({
  data: z.array(integrationConnectionSchema),
  /**
   * The window the *server* judged staleness by. Read rather than assumed, so
   * the sentence on screen cannot quote a different number from the one the
   * status was decided with.
   */
  staleAfterMinutes: z.number().int(),
});

export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>;

/** `GET /integrations/exceptions` (REQ-T-01), as this screen reads it. */
export const syncExceptionSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  kind: z.enum(SYNC_EXCEPTION_KINDS),
  entityType: z.string().nullable(),
  /** Tally's verbatim words — shown as-is, never paraphrased. */
  tallyError: z.string(),
  state: z.enum(SYNC_EXCEPTION_STATES),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});

export type SyncException = z.infer<typeof syncExceptionSchema>;

export const syncExceptionsResponseSchema = z.object({
  data: z.array(syncExceptionSchema),
});

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  DISCONNECTED: 'Never connected',
  CONNECTED: 'Connected',
  STALE: 'Heartbeat overdue',
  ERROR: 'Error',
};

/**
 * Connected is the ordinary state and reads as unremarkable. Stale and error
 * are the two a reader needs to spot while scanning, so they carry the weight;
 * disconnected is outlined, because a connection that was never set up is a
 * fact rather than a fault.
 */
export const STATUS_VARIANT: Record<IntegrationStatus, 'secondary' | 'default' | 'outline' | 'destructive'> =
  {
    CONNECTED: 'secondary',
    STALE: 'default',
    ERROR: 'destructive',
    DISCONNECTED: 'outline',
  };

/**
 * What the status means, in a sentence, for the one column where the label
 * alone is not enough.
 *
 * The server reports `DISCONNECTED` for any connection it has never heard from,
 * whatever the stored column says — so on this screen "Never connected" is a
 * statement about the heartbeat and not about a setting somebody can flip.
 */
export function statusExplanation(
  connection: IntegrationConnection,
  staleAfterMinutes: number,
): string {
  if (connection.transport === 'webhook') {
    switch (connection.status) {
      case 'DISCONNECTED':
        return 'A signing secret is stored but OpsTally has not delivered anything yet. Send a test event from the Agent to check the door.';
      case 'CONNECTED':
        return 'OpsTally has delivered to this connection. It sends only when something changes in Tally, so a quiet stretch is normal.';
      case 'STALE':
        return 'OpsTally has not delivered for a while. It sends only on change; if Tally has been busy, check the Agent is running.';
      case 'ERROR':
        return connection.lastCondition === 'WRONG_COMPANY_OPEN'
          ? 'The last delivery came from a different Tally company than the one this connection is bound to. Switch OpsTally back, or create a connection for the new company.'
          : CONDITION_EXPLANATIONS[connection.lastCondition ?? 'OK'];
    }
  }
  switch (connection.status) {
    case 'DISCONNECTED':
      if (connection.transport === 'unset') {
        return 'Nothing has reported in. Issue an agent token, or store an OpsTally signing secret — the first credential decides how this connection receives data.';
      }
      return 'A token has been issued but no agent has ever reported in on it.';
    case 'CONNECTED':
      return 'The agent reported in within the last few minutes.';
    case 'STALE':
      return `Nothing has been heard for over ${String(staleAfterMinutes)} minutes. The agent may be stopped, or the machine running Tally may be off.`;
    case 'ERROR':
      return CONDITION_EXPLANATIONS[connection.lastCondition ?? 'OK'];
  }
}

/**
 * REQ-Q-05 on screen: the condition names the fix, because "Tally is not
 * running" and "the wrong company is open" send the person walking to that
 * machine with different instructions.
 */
const CONDITION_EXPLANATIONS = {
  OK: 'The agent reported a failure on its last exchange. That is kept even after it goes quiet, because it says more than a missing heartbeat does.',
  TALLY_NOT_RUNNING: 'Tally is not running on the agent machine. Start TallyPrime there; the agent reconnects on its own.',
  WRONG_COMPANY_OPEN: 'Tally is running with the wrong company open. Open the company this connection is bound to; no job runs against the wrong books.',
  LICENCE_LAPSED: 'The Tally licence has lapsed on that machine. Sync waits until it is renewed.',
} as const;
