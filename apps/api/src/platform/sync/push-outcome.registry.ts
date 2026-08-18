import { Injectable, Logger } from '@nestjs/common';
import type { PushKind, VoucherPushPayload } from '@vyuha/shared';

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

/**
 * D-38's other direction: what the pull says about a voucher this side
 * pushed. Tally is the system of record, so a cancellation or a renumbering
 * there is a fact the document here mirrors — never the reverse.
 */
export interface PushMirror {
  readonly remoteGuid: string;
  readonly remoteVoucherNumber: string | null;
  readonly isCancelled: boolean;
  readonly alterId: number;
}

export interface PushOutcomeHandler {
  readonly kind: PushKind;
  onOutcome(tx: Transaction, orgId: string, payload: VoucherPushPayload, outcome: PushOutcome): Promise<void>;
  /** Optional: the pushed voucher came back on the pull, changed or not. */
  onMirror?(tx: Transaction, orgId: string, documentId: string, mirror: PushMirror): Promise<void>;
}

@Injectable()
export class PushOutcomeRegistry {
  private readonly logger = new Logger(PushOutcomeRegistry.name);
  private readonly handlers = new Map<PushKind, PushOutcomeHandler>();

  register(handler: PushOutcomeHandler): void {
    if (this.handlers.has(handler.kind)) {
      throw new Error(`Push outcome for "${handler.kind}" already has a handler registered.`);
    }
    this.handlers.set(handler.kind, handler);
    this.logger.log({ msg: 'Push outcome handler registered', kind: handler.kind });
  }

  find(kind: PushKind): PushOutcomeHandler | null {
    return this.handlers.get(kind) ?? null;
  }
}
