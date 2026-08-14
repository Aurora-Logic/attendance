import { INTEGRATION_STATUSES, INTEGRATION_SYSTEMS, type IntegrationStatus } from '@vyuha/shared';
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
  switch (connection.status) {
    case 'DISCONNECTED':
      return connection.tokenIssued
        ? 'A token has been issued but no agent has ever reported in on it.'
        : 'No agent has ever reported in, and no token has been issued for one to use.';
    case 'CONNECTED':
      return 'The agent reported in within the last few minutes.';
    case 'STALE':
      return `Nothing has been heard for over ${String(staleAfterMinutes)} minutes. The agent may be stopped, or the machine running Tally may be off.`;
    case 'ERROR':
      return 'The agent reported a failure on its last exchange. That is kept even after it goes quiet, because it says more than a missing heartbeat does.';
  }
}
