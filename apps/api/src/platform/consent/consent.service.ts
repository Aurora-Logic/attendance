import { Injectable } from '@nestjs/common';
import { CONSENT_NOTICE_VERSIONS, type ConsentAcceptance, type ConsentKey } from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import {
  DEFAULT_PHOTO_POLICY,
  PHOTO_SETTINGS,
  photoPolicySchema,
  resolveGroup,
} from '../settings/settings.catalogue.js';
import { SettingsRepository } from '../settings/settings.repository.js';
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
   *
   * `executor` lets a caller record the acceptance inside its own transaction
   * -- the punch command does, so an offline first punch and the acceptance it
   * carried commit or fail together (REQ-M-03). The row stamps what the notice
   * promised at that moment (migration 0013): the wording revision from the
   * shared catalogue, and the retention period currently in force, read from
   * the same settings row the punch pipeline enforces it from.
   */
  async record(
    principal: Principal,
    consentKey: ConsentKey,
    executor: Database = this.db,
  ): Promise<ConsentAcceptance> {
    const promised = await this.promisedFor(principal, consentKey);
    const repository = new ConsentRepository(executor, orgContextOf(principal));

    const inserted = await repository.insertAcceptance(principal.userId, consentKey, promised);
    if (inserted !== null) {
      this.auditContext.record({
        action: 'consent.accepted',
        entityType: 'consent_acceptance',
        entityId: inserted.id,
        before: null,
        after: {
          consentKey,
          acceptedAt: inserted.acceptedAt.toISOString(),
          noticeVersion: promised.noticeVersion,
          retentionMonthsQuoted: promised.retentionMonthsQuoted,
        },
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

  /**
   * What the notice for this key is promising right now. Resolved server-side
   * -- never taken from the request -- because a client-asserted number would
   * let the row "prove" a promise nobody made. The punch-capture notice quotes
   * the photo retention period; read deliberately outside any transaction the
   * caller holds, since it is a plain read of the same settings row the
   * Settings screen edits.
   */
  private async promisedFor(
    principal: Principal,
    consentKey: ConsentKey,
  ): Promise<{ noticeVersion: number; retentionMonthsQuoted: number | null }> {
    const noticeVersion = CONSENT_NOTICE_VERSIONS[consentKey];

    if (consentKey === 'attendance.punch_capture') {
      const settings = new SettingsRepository(this.db, orgContextOf(principal));
      const photo = resolveGroup(
        photoPolicySchema,
        PHOTO_SETTINGS,
        DEFAULT_PHOTO_POLICY,
        await settings.readValues(),
      );
      return { noticeVersion, retentionMonthsQuoted: photo.value.retentionMonths };
    }

    return { noticeVersion, retentionMonthsQuoted: null };
  }
}
