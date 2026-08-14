import { Injectable } from '@nestjs/common';
import type {
  IntegrationConnectionView,
  IntegrationListResponse,
  IntegrationStatus,
} from '@vyuha/shared';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { IntegrationRepository, type ConnectionRow } from './integration.repository.js';

/**
 * Technical design §14, the read half.
 *
 * The Integrations screen has been calling `GET /integrations` since it was
 * built and no controller answered it, so it showed sample data in development
 * and an error in production. This is that endpoint, and it is deliberately
 * only what is true: which connections exist and what state each is in. There
 * is no Tally sync here — that is Phase 6 — and no create, token-issue or
 * rotate, because those are credential operations and a route that appeared to
 * mint a token without one would be worse than no route.
 *
 * **Status is derived, not echoed.** The `status` column is written by whatever
 * last talked to the connection, and a row can outlive the truth of it: a
 * database restored from a backup, or a `CONNECTED` written before an agent was
 * ever installed, would have the screen report a healthy Tally link that does
 * not exist. The heartbeat is the fact; the column is a claim about it.
 */

/**
 * How long a silence lasts before a connection is called stale.
 *
 * Technical design §14.1 says "a stale heartbeat raises an admin notification"
 * and names no interval, so this is a default rather than an answer, recorded
 * in OPEN-QUESTIONS. Fifteen minutes is long enough to ride out a restart or a
 * flaky office connection and short enough that somebody finds out the same
 * morning. It decides a label and nothing else — no sync is blocked by it,
 * because there is no sync.
 */
export const STALE_AFTER_MINUTES = 15;

@Injectable()
export class IntegrationService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async list(principal: Principal, now: Date = new Date()): Promise<IntegrationListResponse> {
    const rows = await new IntegrationRepository(this.db, orgContextOf(principal)).list();

    return {
      data: rows.map((row) => toView(row, now)),
      staleAfterMinutes: STALE_AFTER_MINUTES,
    };
  }
}

function toView(row: ConnectionRow, now: Date): IntegrationConnectionView {
  return {
    id: row.id,
    system: row.system,
    name: row.name,
    status: statusOf(row, now),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    tokenIssued: row.tokenIssued,
  };
}

/**
 * What the screen should say, in the order the facts outrank each other.
 *
 * 1. **Never heard from.** A connection with no heartbeat has never connected,
 *    whatever its column says, and that is what the reader needs to know. This
 *    is the state every connection is in today, because nothing writes a
 *    heartbeat yet.
 * 2. **Reported an error.** An error the agent reported is a fact about the
 *    last exchange, and going quiet afterwards does not undo it — showing
 *    "heartbeat overdue" would replace a diagnosis with a symptom.
 * 3. **Gone quiet.** Heard from once, not lately.
 * 4. Otherwise the stored status, which by now is corroborated by a recent
 *    heartbeat.
 */
function statusOf(row: ConnectionRow, now: Date): IntegrationStatus {
  if (row.lastHeartbeatAt === null) return 'DISCONNECTED';
  if (row.storedStatus === 'ERROR') return 'ERROR';

  const silentMs = now.getTime() - row.lastHeartbeatAt.getTime();
  if (silentMs > STALE_AFTER_MINUTES * 60_000) return 'STALE';

  // A row that heartbeated a minute ago and still says DISCONNECTED is a
  // writer that forgot to clear the column; the heartbeat is the better
  // evidence, so it wins.
  return row.storedStatus === 'DISCONNECTED' ? 'CONNECTED' : row.storedStatus;
}
