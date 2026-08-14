import { Injectable } from '@nestjs/common';
import type { ConsentAcceptance, ConsentKey } from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { ConsentRepository } from './consent.repository.js';

/**
 * REQ-M-03: "Acceptance is recorded." Recorded here, once per user per notice.
 *
 * Acceptance is an act of the account on itself, so there is no permission key
 * and no way to accept for somebody else: the user id is always the
 * principal's. What notice exists is fixed by `CONSENT_KEYS` in the shared
 * contract, and the Zod pipe has already refused any other string before this
 * service runs.
 */
@Injectable()
export class ConsentService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async hasAccepted(principal: Principal, consentKey: ConsentKey): Promise<boolean> {
    const repository = new ConsentRepository(this.db, orgContextOf(principal));
    return (await repository.findAcceptance(principal.userId, consentKey)) !== null;
  }

  /**
   * Idempotent by construction: the partial unique index decides who recorded
   * first, and the loser is answered with the winner's instant rather than an
   * error -- accepting a notice twice is not a mistake anybody needs told
   * about. Only a genuinely new acceptance writes an audit row.
   */
  async record(principal: Principal, consentKey: ConsentKey): Promise<ConsentAcceptance> {
    const repository = new ConsentRepository(this.db, orgContextOf(principal));

    const inserted = await repository.insertAcceptance(principal.userId, consentKey);
    if (inserted !== null) {
      this.auditContext.record({
        action: 'consent.accepted',
        entityType: 'consent_acceptance',
        entityId: inserted.id,
        before: null,
        after: { consentKey, acceptedAt: inserted.acceptedAt.toISOString() },
      });
      return { consentKey, acceptedAt: inserted.acceptedAt.toISOString(), replayed: false };
    }

    const existing = await repository.findAcceptance(principal.userId, consentKey);
    if (existing === null) {
      throw new Error(
        `Consent insert for "${consentKey}" was refused but no existing acceptance was found.`,
      );
    }
    return { consentKey, acceptedAt: existing.acceptedAt.toISOString(), replayed: true };
  }
}
