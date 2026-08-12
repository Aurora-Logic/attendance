import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AuditService } from '../audit/audit.service.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { sessions } from '../db/schema/index.js';
import { generateOpaqueToken, hashOpaqueToken, TOKEN_PURPOSES } from './opaque-token.js';

/**
 * REQ-B-05: "Sessions: short-lived access token + rotating refresh token.
 * Refresh token reuse detection revokes the family and forces re-login."
 *
 * The model, restated because the whole file depends on getting it right:
 *
 * - One row per *issued token*, not per login. `family_id` groups every token
 *   descended from one login.
 * - Rotation marks the presented row `used_at` and inserts a child in the same
 *   family. A token is therefore valid exactly once.
 * - Presenting a token that already has `used_at` means two parties hold it.
 *   Only one of them is the legitimate client and there is no way to tell
 *   which, so the whole family dies and both must log in again.
 *
 * That last consequence is the design working, not a rough edge. A stolen
 * refresh token is otherwise silently useful for a month; this turns it into a
 * detectable event with a bounded blast radius.
 */

const REVOCATION_REASONS = {
  REUSE: 'refresh token reuse detected',
  LOGOUT: 'logout',
  PASSWORD_CHANGED: 'password changed',
} as const;

export interface IssuedSession {
  readonly sessionId: string;
  readonly familyId: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface SessionRequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface RotatedSession extends IssuedSession {
  readonly userId: string;
  readonly orgId: string;
  /** The row that was just consumed, for audit attribution. */
  readonly previousSessionId: string;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The outcome of looking at a presented token, decided inside the transaction
 * and acted on outside it.
 *
 * Reuse detection has to *commit* the revocation. Throwing from inside the
 * transaction would roll back the very revocation the throw exists to
 * announce, leaving the family alive and the attacker's token working -- with
 * a 401 on the response making it look as though the control had fired.
 */
type RotationOutcome =
  | { readonly kind: 'rotated'; readonly session: RotatedSession }
  | { readonly kind: 'reused'; readonly familyId: string; readonly userId: string; readonly orgId: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'expired' };

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private hash(token: string): string {
    return hashOpaqueToken(TOKEN_PURPOSES.REFRESH, token, env.JWT_REFRESH_SECRET);
  }

  private expiry(from: Date): Date {
    return new Date(from.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);
  }

  /** A fresh family. Called on login and nowhere else. */
  async startFamily(
    orgId: string,
    userId: string,
    context: SessionRequestContext,
  ): Promise<IssuedSession> {
    const token = generateOpaqueToken();
    const now = new Date();
    const rows = await this.db
      .insert(sessions)
      .values({
        orgId,
        userId,
        refreshTokenHash: this.hash(token),
        // The first row's own id is the family id, so a family is traceable to
        // the login that started it without a second table.
        familyId: sql`uuid_generate_v7()`,
        ip: context.ip,
        userAgent: context.userAgent,
        expiresAt: this.expiry(now),
      })
      .returning({ id: sessions.id, familyId: sessions.familyId, expiresAt: sessions.expiresAt });

    const row = rows[0];
    if (row === undefined) throw new Error('Session insert returned no row.');

    return {
      sessionId: row.id,
      familyId: row.familyId,
      refreshToken: token,
      expiresAt: row.expiresAt,
    };
  }

  async rotate(presentedToken: string, context: SessionRequestContext): Promise<RotatedSession> {
    const outcome = await this.db.transaction((tx) => this.decide(tx, presentedToken, context));

    switch (outcome.kind) {
      case 'rotated':
        return outcome.session;

      case 'reused':
        this.logger.warn({
          msg: 'Refresh token reuse detected; the session family has been revoked.',
          familyId: outcome.familyId,
          userId: outcome.userId,
          orgId: outcome.orgId,
          ip: context.ip,
        });
        // Written directly rather than through `AuditContext`, because the
        // interceptor only audits successful requests and this one is about
        // to answer 401. It is also the single most important row this
        // subsystem can produce: it is the evidence that a refresh token was
        // held by two parties.
        await this.audit.write({
          orgId: outcome.orgId,
          actorUserId: outcome.userId,
          action: 'session.reuse_detected',
          entityType: 'session',
          after: {
            familyId: outcome.familyId,
            ip: context.ip,
            userAgent: context.userAgent,
            outcome: 'family revoked',
          },
          ip: context.ip,
          userAgent: context.userAgent,
        });
        throw new AppError(
          ERROR_CODES.REFRESH_TOKEN_REUSED,
          'This session was already refreshed elsewhere. All sessions from that sign-in have been ended; sign in again.',
        );

      case 'revoked':
        throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This session has been ended.');

      case 'expired':
        throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'This session has expired; sign in again.');

      case 'unknown':
        throw new AppError(ERROR_CODES.TOKEN_INVALID, 'Refresh token is not recognised.');
    }
  }

  /**
   * `FOR UPDATE` on the presented row is what makes reuse detection sound
   * under concurrency. Two requests arriving with the same token serialise
   * here; the first marks it used, the second then reads `used_at` set and
   * reports reuse. Without the lock both would read null and both would
   * succeed, which is precisely the situation the feature exists to notice.
   */
  private async decide(
    tx: Transaction,
    presentedToken: string,
    context: SessionRequestContext,
  ): Promise<RotationOutcome> {
    const rows = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, this.hash(presentedToken)))
      .for('update')
      .limit(1);

    const row = rows[0];
    if (row === undefined) return { kind: 'unknown' };

    if (row.usedAt !== null) {
      await this.revokeFamilyWithin(tx, row.familyId, REVOCATION_REASONS.REUSE);
      return { kind: 'reused', familyId: row.familyId, userId: row.userId, orgId: row.orgId };
    }

    if (row.revokedAt !== null) return { kind: 'revoked' };

    const now = new Date();
    if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };

    await tx.update(sessions).set({ usedAt: now }).where(eq(sessions.id, row.id));

    const token = generateOpaqueToken();
    const inserted = await tx
      .insert(sessions)
      .values({
        orgId: row.orgId,
        userId: row.userId,
        refreshTokenHash: this.hash(token),
        familyId: row.familyId,
        deviceFingerprint: row.deviceFingerprint,
        ip: context.ip,
        userAgent: context.userAgent,
        // Rolling, not fixed to the family's original expiry: an active user
        // is not signed out mid-shift thirty days after they first logged in.
        expiresAt: this.expiry(now),
      })
      .returning({ id: sessions.id, expiresAt: sessions.expiresAt });

    const child = inserted[0];
    if (child === undefined) throw new Error('Session rotation returned no row.');

    return {
      kind: 'rotated',
      session: {
        sessionId: child.id,
        familyId: row.familyId,
        refreshToken: token,
        expiresAt: child.expiresAt,
        userId: row.userId,
        orgId: row.orgId,
        previousSessionId: row.id,
      },
    };
  }

  /** REQ-B-06 / logout. Returns how many live rows were ended. */
  async revokeFamily(familyId: string, reason: string): Promise<number> {
    return this.revokeFamilyWithin(this.db, familyId, reason);
  }

  private async revokeFamilyWithin(
    executor: Database | Transaction,
    familyId: string,
    reason: string,
  ): Promise<number> {
    const rows = await executor
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /**
   * REQ-B-04: "Password change invalidates all other sessions." `exceptFamily`
   * is for the case where the change was made from a live session that should
   * survive it; a reset completed from an emailed link passes nothing, and
   * every session dies.
   */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptFamilyId?: string,
  ): Promise<number> {
    const predicate =
      exceptFamilyId === undefined
        ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt))
        : and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            sql`${sessions.familyId} <> ${exceptFamilyId}`,
          );

    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(predicate)
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Looks up the family a presented refresh token belongs to, without rotating. */
  async familyOf(presentedToken: string): Promise<{ familyId: string; userId: string; orgId: string } | null> {
    const rows = await this.db
      .select({ familyId: sessions.familyId, userId: sessions.userId, orgId: sessions.orgId })
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, this.hash(presentedToken)))
      .limit(1);
    return rows[0] ?? null;
  }

  static get reasons(): typeof REVOCATION_REASONS {
    return REVOCATION_REASONS;
  }
}
