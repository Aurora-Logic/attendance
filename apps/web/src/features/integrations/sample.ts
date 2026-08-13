import type { IntegrationsResponse } from './types';

/**
 * What `GET /integrations` would answer for a Phase 0 deployment.
 *
 * One TALLY row, disconnected, no heartbeat and no token -- which is exactly
 * the state technical design §14 describes for this phase: "the tables and the
 * interface exist now so Phase 6 is additive. Nothing syncs yet."
 *
 * Deliberately not a connected-looking sample. A screen showing a healthy Tally
 * link that does not exist is the one outcome worth avoiding here, notice or no
 * notice.
 */
export function sampleIntegrations(): IntegrationsResponse {
  return {
    data: [
      {
        id: 'sample-integration-1',
        system: 'TALLY',
        name: 'TallyPrime (head office)',
        status: 'DISCONNECTED',
        lastHeartbeatAt: null,
        tokenIssued: false,
      },
    ],
  };
}
