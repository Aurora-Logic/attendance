import { Injectable, Logger } from '@nestjs/common';
import type { SalesDocumentType, VoucherPushPayload } from '@vyuha/shared';

import type { Transaction } from '../db/db.provider.js';

/**
 * 09 §3.3, the last hop: what happens to a document when the agent reports
 * its push landed, landed on retry, or was rejected. The sync writer owns
 * the job row, the journal, and `external_refs`; the module that owns the
 * document owns its own row and registers here to be told — the same shape
 * as every other platform-to-module seam, for the same reason (technical
 * design §1: the platform never imports a module).
 */
export interface PushOutcome {
  readonly outcome: 'accepted' | 'landed_on_retry' | 'rejected';
  readonly remoteGuid: string | null;
  readonly remoteVoucherNumber: string | null;
  readonly errorText: string | null;
}

export interface PushOutcomeHandler {
  readonly docType: SalesDocumentType;
  onOutcome(tx: Transaction, orgId: string, payload: VoucherPushPayload, outcome: PushOutcome): Promise<void>;
}

@Injectable()
export class PushOutcomeRegistry {
  private readonly logger = new Logger(PushOutcomeRegistry.name);
  private readonly handlers = new Map<SalesDocumentType, PushOutcomeHandler>();

  register(handler: PushOutcomeHandler): void {
    if (this.handlers.has(handler.docType)) {
      throw new Error(`Push outcome for "${handler.docType}" already has a handler registered.`);
    }
    this.handlers.set(handler.docType, handler);
    this.logger.log({ msg: 'Push outcome handler registered', docType: handler.docType });
  }

  find(docType: SalesDocumentType): PushOutcomeHandler | null {
    return this.handlers.get(docType) ?? null;
  }
}
