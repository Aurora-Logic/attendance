import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  OPSTALLY_SECRET_PREFIX,
  opsTallyEventSchema,
  type OpsTallyAck,
  type OpsTallyEvent,
  type OpsTallyLedger,
  type OpsTallyStockItem,
  type OpsTallyVoucher,
  type PartyPullRow,
  type StockItemPullRow,
  type VoucherPullRow,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { LoginRateLimiter } from '../auth/login-rate-limit.service.js';
import { openSecret } from '../auth/secret-box.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database, type Transaction } from '../db/db.provider.js';
import { WEBHOOK_SECRET_PURPOSE } from '../integration/integration.service.js';
import {
  findWebhookConnection,
  type WebhookConnectionRow,
} from '../integration/integration.repository.js';
import { SyncWriterService, type WriterScope } from './sync-writer.service.js';

/**
 * The OpsTally webhook door (the "OpsTally Webhooks" reference, v1).
 *
 * OpsTally Agent runs beside TallyPrime and POSTs one signed JSON event per
 * change to a URL Vyuha gives out per connection. This service is the whole
 * of what Vyuha does with a delivery, in the order the reference asks for:
 *
 * 1. **Verify before reading.** `X-Tally-Signature` is HMAC-SHA256 over the
 *    exact raw body bytes with the connection's `whsec_` secret. Anything
 *    that fails is 401 and nothing else happens — no parse, no row, no log
 *    line naming the connection. A wrong signature is a credential guess and
 *    is throttled like one.
 * 2. **Bind.** The first verified delivery binds the Agent's install id and
 *    the exact company name; a later delivery from another install or
 *    another company is refused with that specific reason (REQ-Q-03, Q-05).
 * 3. **Dedupe.** Retries reuse the event id, so the id is the idempotency
 *    key: `sync_inbox` holds one row per id, inserted inside the same
 *    transaction as the writes, and a repeat is a 200 that does nothing.
 * 4. **Project.** Ledgers under the party groups become parties, stock items
 *    become stock items — through the same writer the pull path uses, so a
 *    master arriving by push lands exactly as one arriving by pull. Vouchers
 *    are accepted, journalled, and *retained* in the inbox for Phase 6c to
 *    replay; acknowledging them now keeps the Agent from retrying for ten
 *    hours, retaining them keeps ninety days of vouchers from vanishing at a
 *    phase boundary.
 * 5. **Answer 2xx fast.** The reference gives thirty seconds. Everything
 *    here is one short transaction.
 *
 * A delivery Vyuha cannot understand (validation failure) is *acknowledged*
 * and raised as a sync exception rather than refused: a 4xx would make the
 * Agent retry the same bytes twelve times over ten hours, and a person can
 * act on the exception long before that.
 */

/** OpsTally's ledger groups that are parties in Vyuha's sense (08 §3). */
const PARTY_GROUP_PREFIXES = ['sundry debtors', 'sundry creditors'];

function isPartyGroup(parent: string): boolean {
  const normalized = parent.trim().toLowerCase();
  return PARTY_GROUP_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** JSON numbers held as text for `numeric` — the digits as they arrived (D-01). */
function decimal(value: number): string {
  return String(value);
}

function ledgerToParty(ledger: OpsTallyLedger): PartyPullRow {
  return {
    guid: ledger.guid,
    alterId: ledger.alterId,
    name: ledger.name,
    parentGroup: ledger.parent,
    ...(ledger.gstin === null || ledger.gstin === undefined || ledger.gstin === ''
      ? {}
      : { gstin: ledger.gstin }),
    ...(ledger.email === null || ledger.email === undefined || ledger.email === '' ? {} : { email: ledger.email }),
    ...(ledger.mobile === null || ledger.mobile === undefined || ledger.mobile === '' ? {} : { phone: ledger.mobile }),
  };
}

function stockToRow(item: OpsTallyStockItem): StockItemPullRow {
  return {
    guid: item.guid,
    alterId: item.alterId,
    name: item.name,
    unit: item.baseUnits === '' ? 'Nos' : item.baseUnits,
    parentGroup: item.parent === '' ? 'Primary' : item.parent,
    closingQty: decimal(item.closingQty),
    salePrice: decimal(item.salePrice),
    costPrice: decimal(item.costPrice),
  };
}

/** Tally's YYYYMMDD → ISO YYYY-MM-DD; the reference gives no other date shape. */
function tallyDateToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function voucherToRow(voucher: OpsTallyVoucher): VoucherPullRow {
  return {
    guid: voucher.guid,
    masterId: voucher.masterId,
    alterId: voucher.alterId,
    date: tallyDateToIso(voucher.date),
    voucherType: voucher.voucherType === '' ? 'Unknown' : voucher.voucherType,
    voucherNumber: voucher.voucherNumber,
    partyName: voucher.party,
    narration: voucher.narration,
    isCancelled: voucher.isCancelled,
    amount: decimal(voucher.amount),
    lines: [
      ...voucher.ledgerEntries.map((entry) => ({
        kind: 'ledger' as const,
        ledgerName: entry.ledgerName,
        amount: decimal(entry.amount),
        isDeemedPositive: entry.isDeemedPositive,
      })),
      ...voucher.inventoryEntries.map((entry) => ({
        kind: 'inventory' as const,
        stockItemName: entry.stockItemName,
        actualQty: entry.actualQty,
        billedQty: entry.billedQty,
        rate: decimal(entry.rate),
        amount: decimal(entry.amount),
      })),
    ],
  };
}

@Injectable()
export class OpsTallyWebhookService {
  private readonly logger = new Logger(OpsTallyWebhookService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly writer: SyncWriterService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  async receive(input: {
    connectionId: string;
    rawBody: Buffer;
    signature: string | undefined;
    eventIdHeader: string | undefined;
    ip: string | null;
  }): Promise<OpsTallyAck> {
    // The claim stands as a recorded failure unless this delivery verifies.
    const claim = await this.limiter.claimAttempt(input.ip, Date.now(), 'webhook');

    const connection = await findWebhookConnection(this.db, input.connectionId);
    // One answer for "no such connection", "no secret yet" and "wrong
    // signature": whoever is probing learns nothing about which it was.
    if (connection === null || connection.webhookSecretEnc === null) {
      throw unauthorised();
    }
    const secret = openSecret(connection.webhookSecretEnc, env.JWT_REFRESH_SECRET, WEBHOOK_SECRET_PURPOSE);
    if (!verifySignature(input.rawBody, input.signature, secret)) {
      throw unauthorised();
    }
    await this.limiter.release(claim);

    const requestHash = `sha256:${createHash('sha256').update(input.rawBody).digest('hex')}`;
    const bodyText = input.rawBody.toString('utf8');
    const scope: WriterScope = { orgId: connection.orgId, connectionId: connection.id };

    // Parse only after the HMAC has spoken for the bytes.
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return this.acknowledgeRejected(scope, connection, {
        eventId: input.eventIdHeader ?? null,
        eventType: 'unparseable',
        reason: 'The body is not JSON.',
        requestHash,
        bodyText,
      });
    }
    const validated = opsTallyEventSchema.safeParse(parsed);
    if (!validated.success) {
      const record = parsed as { id?: unknown; event?: unknown };
      return this.acknowledgeRejected(scope, connection, {
        eventId:
          input.eventIdHeader ?? (typeof record.id === 'string' ? record.id : null),
        eventType: typeof record.event === 'string' ? record.event : 'unknown',
        reason: validated.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
        requestHash,
        bodyText,
      });
    }
    const event = validated.data;

    // Bindings are refused outside the transaction: a refusal writes the
    // condition, never the event.
    await this.enforceBindings(connection, event);

    return this.db.transaction(async (tx) => {
      const claimed = await tx.execute<{ id: string }>(sql`
        INSERT INTO sync_inbox (org_id, connection_id, event_id, event_type, result)
        VALUES (${scope.orgId}, ${scope.connectionId}, ${event.id}, ${event.event}, 'processing')
        ON CONFLICT (connection_id, event_id) DO NOTHING
        RETURNING id
      `);
      const inboxId = claimed.rows[0]?.id;
      if (inboxId === undefined) {
        // The reference: "retries reuse the exact same id … treat repeats as
        // no-ops". Nothing else runs — not the journal, not the writer.
        return { ok: true, eventId: event.id, duplicate: true, result: 'already accepted' };
      }

      const outcome = await this.apply(tx, scope, event);

      await tx.execute(sql`
        INSERT INTO sync_journal
          (org_id, connection_id, direction, entity_type, request_hash, request_body, result)
        VALUES
          (${scope.orgId}, ${scope.connectionId}, 'PULL', ${outcome.entityType},
           ${requestHash}, ${bodyText.length > 512_000 ? null : bodyText}, ${outcome.result})
      `);
      await tx.execute(sql`
        UPDATE sync_inbox
           SET result = ${outcome.result},
               payload = ${outcome.retainPayload ? JSON.stringify(event) : null}::jsonb
         WHERE id = ${inboxId}
      `);
      // A verified delivery is the liveness signal a webhook connection has.
      // The install/company bindings land here too, in the same commit as
      // the first event they were bound by.
      await tx.execute(sql`
        UPDATE integration_connections
           SET last_heartbeat_at = now(),
               status = 'CONNECTED',
               last_condition = 'OK',
               webhook_install_id = COALESCE(webhook_install_id, ${event.install_id}),
               company_name = CASE WHEN webhook_install_id IS NULL THEN ${event.company} ELSE company_name END,
               updated_at = now(),
               updated_by = NULL
         WHERE id = ${scope.connectionId}
      `);

      return { ok: true, eventId: event.id, duplicate: false, result: outcome.result };
    });
  }

  /**
   * REQ-Q-03 and Q-05 for the push door. The first verified delivery is
   * authoritative for both bindings — including overwriting a company name an
   * administrator typed at creation, because "G C Communication (2026-27)"
   * and Tally's exact spelling of it must not lock a working integration out
   * over a bracket. After that, a different install or company is refused,
   * and the connection's condition says why on the Integrations screen.
   */
  private async enforceBindings(connection: WebhookConnectionRow, event: OpsTallyEvent): Promise<void> {
    if (connection.webhookInstallId === null) return;

    if (connection.webhookInstallId !== event.install_id) {
      this.logger.warn({
        msg: 'OpsTally delivery from a second install refused',
        connectionId: connection.id,
        boundInstallId: connection.webhookInstallId,
        presentedInstallId: event.install_id,
      });
      throw AppError.conflict(
        'This connection is bound to another OpsTally install. One company, one connection: ' +
          'create a separate connection for a second install, or regenerate this connection’s ' +
          'secret to re-bind it.',
      );
    }
    if (connection.companyName !== null && connection.companyName !== event.company) {
      await this.db.execute(sql`
        UPDATE integration_connections
           SET status = 'ERROR', last_condition = 'WRONG_COMPANY_OPEN', updated_at = now(), updated_by = NULL
         WHERE id = ${connection.id}
      `);
      throw AppError.conflict(
        `This connection is bound to the Tally company "${connection.companyName}"; the delivery ` +
          `came from "${event.company}". Work against the wrong books is worse than work that ` +
          'waits — switch OpsTally back to the bound company, or create a connection for the new one.',
        { boundCompany: connection.companyName, presentedCompany: event.company },
      );
    }
  }

  private async apply(
    tx: Transaction,
    scope: WriterScope,
    event: OpsTallyEvent,
  ): Promise<{ entityType: string | null; result: string; retainPayload: boolean }> {
    switch (event.event) {
      case 'ping':
        return { entityType: null, result: 'pong', retainPayload: false };

      case 'stock.updated': {
        const row = stockToRow(event.payload);
        await this.writer.applyRows(tx, scope, { entityType: 'stock_item', rows: [row] });
        await this.advanceCursor(tx, scope, 'stock_item', row.alterId);
        return { entityType: 'stock_item', result: 'ok: 1 stock item', retainPayload: false };
      }

      case 'stock.snapshot': {
        const rows = event.payload.items.map(stockToRow);
        await this.writer.applyRows(tx, scope, { entityType: 'stock_item', rows });
        const maxAlterId = rows.reduce((max, row) => Math.max(max, row.alterId), 0);
        await this.advanceCursor(tx, scope, 'stock_item', maxAlterId);
        return {
          entityType: 'stock_item',
          result: `ok: snapshot chunk ${String(event.payload.chunk)}/${String(event.payload.total_chunks)}, ${String(rows.length)} stock items`,
          retainPayload: false,
        };
      }

      case 'ledger.created':
      case 'ledger.updated': {
        if (!isPartyGroup(event.payload.parent)) {
          return {
            entityType: 'ledger',
            result: `skipped: ledger group "${event.payload.parent}" is not a party group`,
            retainPayload: false,
          };
        }
        const row = ledgerToParty(event.payload);
        await this.writer.applyRows(tx, scope, { entityType: 'party', rows: [row] });
        await this.advanceCursor(tx, scope, 'party', row.alterId);
        return { entityType: 'party', result: 'ok: 1 party', retainPayload: false };
      }

      case 'voucher.created':
      case 'voucher.updated':
      case 'voucher.cancelled': {
        // `voucher.cancelled` is the same shape with isCancelled true; the
        // upsert carries the flag, so all three land through one path.
        const row = voucherToRow(event.payload);
        await this.writer.applyRows(tx, scope, { entityType: 'voucher', rows: [row] });
        await this.advanceCursor(tx, scope, 'voucher', row.alterId);
        return {
          entityType: 'voucher',
          result: `ok: 1 voucher (${row.voucherType}${row.isCancelled ? ', cancelled' : ''})`,
          retainPayload: false,
        };
      }

      case 'voucher.snapshot': {
        const rows = event.payload.vouchers.map(voucherToRow);
        await this.writer.applyRows(tx, scope, { entityType: 'voucher', rows });
        const maxAlterId = rows.reduce((max, row) => Math.max(max, row.alterId), 0);
        await this.advanceCursor(tx, scope, 'voucher', maxAlterId);
        return {
          entityType: 'voucher',
          result: `ok: snapshot chunk ${String(event.payload.chunk)}/${String(event.payload.total_chunks)}, ${String(rows.length)} vouchers`,
          retainPayload: false,
        };
      }
    }
  }

  /**
   * Vouchers that arrived before the projection existed were acknowledged
   * and retained in `sync_inbox.payload` (OPEN-QUESTIONS P6b-4). This
   * replays them through the same path a live delivery takes, oldest first
   * per connection, clearing the payload as each lands. Idempotent: a row
   * whose payload no longer validates is left with its payload and its
   * result says why, so it can be looked at rather than silently dropped.
   */
  async replayDeferred(limit = 500): Promise<{ replayed: number; skipped: number }> {
    const pending = await this.db.execute<{
      id: string;
      org_id: string;
      connection_id: string;
      payload: unknown;
    }>(sql`
      SELECT id, org_id, connection_id, payload FROM sync_inbox
       WHERE payload IS NOT NULL
       ORDER BY connection_id, received_at
       LIMIT ${limit}
    `);

    let replayed = 0;
    let skipped = 0;
    for (const row of pending.rows) {
      const validated = opsTallyEventSchema.safeParse(row.payload);
      if (!validated.success || !validated.data.event.startsWith('voucher.')) {
        skipped += 1;
        await this.db.execute(sql`
          UPDATE sync_inbox SET result = ${'replay skipped: retained payload no longer validates'}
           WHERE id = ${row.id}
        `);
        continue;
      }
      const scope: WriterScope = { orgId: row.org_id, connectionId: row.connection_id };
      await this.db.transaction(async (tx) => {
        const outcome = await this.apply(tx, scope, validated.data);
        await tx.execute(sql`
          UPDATE sync_inbox SET result = ${`replayed: ${outcome.result}`}, payload = NULL WHERE id = ${row.id}
        `);
      });
      replayed += 1;
    }
    if (replayed > 0 || skipped > 0) {
      this.logger.log({ msg: 'Deferred OpsTally vouchers replayed', replayed, skipped });
    }
    return { replayed, skipped };
  }

  private async advanceCursor(
    tx: Transaction,
    scope: WriterScope,
    entityType: 'party' | 'stock_item' | 'voucher',
    alterId: number,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO sync_cursors (org_id, connection_id, entity_type, last_alter_id, last_run_at)
      VALUES (${scope.orgId}, ${scope.connectionId}, ${entityType}, ${alterId}, now())
      ON CONFLICT (connection_id, entity_type)
      DO UPDATE SET last_alter_id = GREATEST(sync_cursors.last_alter_id, EXCLUDED.last_alter_id),
                    last_run_at = now(),
                    updated_at = now()
    `);
  }

  /**
   * A verified delivery Vyuha could not understand. Acknowledged (2xx) so
   * the Agent does not retry the same bytes for ten hours; journalled with
   * the body so the bytes are kept; raised as an exception so a person sees
   * it (REQ-T-01). Deduped by event id when one is available, so the retry
   * that arrives anyway does not raise a second exception.
   */
  private async acknowledgeRejected(
    scope: WriterScope,
    connection: WebhookConnectionRow,
    rejection: {
      eventId: string | null;
      eventType: string;
      reason: string;
      requestHash: string;
      bodyText: string;
    },
  ): Promise<OpsTallyAck> {
    const result = `rejected: ${rejection.reason}`;
    return this.db.transaction(async (tx) => {
      if (rejection.eventId !== null) {
        const claimed = await tx.execute<{ id: string }>(sql`
          INSERT INTO sync_inbox (org_id, connection_id, event_id, event_type, result)
          VALUES (${scope.orgId}, ${scope.connectionId}, ${rejection.eventId}, ${rejection.eventType}, ${result})
          ON CONFLICT (connection_id, event_id) DO NOTHING
          RETURNING id
        `);
        if (claimed.rows[0] === undefined) {
          return { ok: true, eventId: rejection.eventId, duplicate: true, result: 'already accepted' };
        }
      }
      await tx.execute(sql`
        INSERT INTO sync_journal
          (org_id, connection_id, direction, entity_type, request_hash, request_body, result, error_text)
        VALUES
          (${scope.orgId}, ${scope.connectionId}, 'PULL', ${rejection.eventType},
           ${rejection.requestHash}, ${rejection.bodyText.length > 512_000 ? null : rejection.bodyText},
           ${result}, ${rejection.reason})
      `);
      await tx.execute(sql`
        INSERT INTO sync_exceptions (org_id, connection_id, kind, entity_type, tally_error)
        VALUES (${scope.orgId}, ${scope.connectionId}, 'REJECTION', ${rejection.eventType},
                ${`OpsTally delivery could not be understood. ${rejection.reason}`})
      `);
      this.logger.warn({
        msg: 'OpsTally delivery rejected',
        connectionId: connection.id,
        eventType: rejection.eventType,
        reason: rejection.reason,
      });
      return { ok: true, eventId: rejection.eventId ?? '', duplicate: false, result };
    });
  }
}

function unauthorised(): AppError {
  return new AppError(ERROR_CODES.TOKEN_INVALID, 'This delivery is not signed for this connection.');
}

/**
 * The reference's exact rule: hex HMAC-SHA256 of the raw body, compared in
 * constant time. Case-insensitive on the hex, strict on the length.
 */
export function verifySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (header === undefined || header === '') return false;
  if (!secret.startsWith(OPSTALLY_SECRET_PREFIX)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(header.trim().toLowerCase(), 'hex');
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
