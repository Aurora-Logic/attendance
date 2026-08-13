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
});

export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>;

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  DISCONNECTED: 'Not connected',
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
