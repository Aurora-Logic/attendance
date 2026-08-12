import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AuditService } from '../audit/audit.service.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import {
  employees,
  invitations,
  passwordResets,
  roles,
  userRoles,
  users,
} from '../db/schema/index.js';
import { Mailer } from '../mail/mailer.js';
import type { Principal } from '../rbac/principal.js';
import { PrincipalService } from '../rbac/principal.service.js';
import type {
  CreateInvitationDto,
  LoginDto,
  LoginResponse,
  MeResponse,
} from './auth.dto.js';
import { signAccessToken } from './jwt.js';
import { LoginRateLimiter } from './login-rate-limit.service.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isWellFormedToken,
  TOKEN_PURPOSES,
} from './opaque-token.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { assertPasswordAcceptable } from './password-policy.js';
import { SessionService, type SessionRequestContext } from './session.service.js';

/**
 * The auth surface (REQ-B-01 … REQ-B-10).
 *
 * There is no signup method here and no route that could reach one. ADR 0002:
 * "Account creation happens one way only: Admin or HR issues an invitation
 * against an existing employee record ... Absence of a route is the access
 * control."
 */

/** REQ-B-10: five failures per account per fifteen minutes, then fifteen locked. */
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

/** REQ-B-03: single-use, 72 hours. REQ-B-04: single-use, 30 minutes. */
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export interface LoginResult {
  readonly response: LoginResponse;
  readonly refreshToken: string;
}

export interface RefreshResult {
  readonly response: LoginResponse;
  readonly refreshToken: string;
}

export interface InvitationResult {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: string;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly principals: PrincipalService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly mailer: Mailer,
    private readonly auditContext: AuditContext,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- login

  async login(input: LoginDto, context: SessionRequestContext): Promise<LoginResult> {
    this.rateLimiter.assertWithinBudget(context.ip);

    const user = await this.findByEmail(input.email);
    const now = new Date();

    // REQ-B-10: a lockout holds even for the correct password. Checked before
    // the hash so a locked account costs nothing to refuse -- and so that a
    // brute-force run cannot use the lockout window to keep testing passwords.
    if (user !== null && user.lockedUntil !== null && user.lockedUntil > now) {
      this.rateLimiter.recordFailure(context.ip);
      throw new AppError(ERROR_CODES.ACCOUNT_LOCKED, 'This account is temporarily locked.', {
        details: { lockedUntil: user.lockedUntil.toISOString() },
      });
    }

    // Runs against a decoy hash when there is no user, so the response takes
    // the same time either way and login cannot be used to discover which
    // addresses have accounts.
    const correct = await verifyPassword(input.password, user?.passwordHash ?? null);

    if (!correct || user === null) {
      if (user !== null) await this.recordFailedAttempt(user, now);
      this.rateLimiter.recordFailure(context.ip);
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect.');
    }

    // Only after the password is proven. Telling an unauthenticated caller
    // that an account exists but is suspended is the same leak as telling them
    // it exists at all.
    if (user.status !== 'ACTIVE') {
      this.rateLimiter.recordFailure(context.ip);
      throw new AppError(
        ERROR_CODES.ACCOUNT_INACTIVE,
        user.status === 'INVITED'
          ? 'This account has not accepted its invitation yet.'
          : 'This account is suspended.',
      );
    }

    this.rateLimiter.clear(context.ip);

    const session = await this.sessions.startFamily(user.orgId, user.id, context);

    await this.db
      .update(users)
      .set({
        lastLoginAt: now,
        failedAttempts: 0,
        failedAttemptsSince: null,
        lockedUntil: null,
        // ADR 0002: "password hashes carry their parameters so old hashes stay
        // verifiable after a change". A successful login is the only moment
        // the plaintext is available to upgrade one.
        ...(needsRehash(user.passwordHash)
          ? { passwordHash: await hashPassword(input.password) }
          : {}),
      })
      .where(eq(users.id, user.id));

    this.auditContext.record({
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      after: { sessionId: session.sessionId, ip: context.ip },
    });

    return {
      refreshToken: session.refreshToken,
      response: this.accessResponse(user.orgId, user.id, user.email, session.sessionId),
    };
  }

  /**
   * REQ-B-10. The window is what makes this "five per fifteen minutes" rather
   * than "five ever": a run of failures older than the window is a different
   * run, and starts the count again.
   */
  private async recordFailedAttempt(
    user: { id: string; orgId: string; email: string; failedAttempts: number; failedAttemptsSince: Date | null },
    now: Date,
  ): Promise<void> {
    const windowOpen =
      user.failedAttemptsSince !== null &&
      now.getTime() - user.failedAttemptsSince.getTime() < ATTEMPT_WINDOW_MS;

    const attempts = windowOpen ? user.failedAttempts + 1 : 1;
    const since = windowOpen ? user.failedAttemptsSince : now;
    const locked = attempts >= MAX_FAILED_ATTEMPTS;

    await this.db
      .update(users)
      .set({
        failedAttempts: attempts,
        failedAttemptsSince: since,
        lockedUntil: locked ? new Date(now.getTime() + LOCKOUT_MS) : null,
      })
      .where(eq(users.id, user.id));

    if (!locked) return;

    this.logger.warn({ msg: 'Account locked after repeated failures', userId: user.id, attempts });

    // Direct rather than through `AuditContext`: the request this happened on
    // is about to answer 401, and the interceptor only audits successes. A
    // lockout is a state change on the account and belongs in the trail --
    // individual failed attempts do not, or an attacker could fill the table.
    await this.audit.write({
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'auth.account_locked',
      entityType: 'user',
      entityId: user.id,
      after: { failedAttempts: attempts, lockedForMinutes: LOCKOUT_MS / 60_000 },
    });

    // REQ-B-10 asks for an email notice. This is also the only signal a real
    // user gets that someone is trying their address.
    await this.mailer.send({
      to: user.email,
      subject: 'Your account has been temporarily locked',
      body:
        `There have been ${String(attempts)} failed sign-in attempts for your account. ` +
        'For your protection it is locked for 15 minutes. If this was not you, ' +
        'change your password once the lock expires.',
    });
  }

  // -------------------------------------------------------------- refresh

  async refresh(presentedToken: string, context: SessionRequestContext): Promise<RefreshResult> {
    if (!isWellFormedToken(presentedToken)) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'Refresh token is not recognised.');
    }

    // A rotation every fifteen minutes per signed-in user would be the single
    // largest producer of audit rows in the product and would bury everything
    // worth reading. Reuse detection is not suppressed: SessionService records
    // that case explicitly.
    this.auditContext.suppress();

    const rotated = await this.sessions.rotate(presentedToken, context);

    // The account may have been suspended or deleted since the token was
    // issued. Resolving the principal applies every one of those checks in one
    // place rather than repeating them here.
    const principal = await this.principals.resolve({
      userId: rotated.userId,
      orgId: rotated.orgId,
      sessionId: rotated.sessionId,
      issuedAtSeconds: Math.floor(Date.now() / 1000),
    });

    return {
      refreshToken: rotated.refreshToken,
      response: this.accessResponse(
        principal.orgId,
        principal.userId,
        principal.email,
        rotated.sessionId,
      ),
    };
  }

  // --------------------------------------------------------------- logout

  /**
   * Revokes the family the presented refresh token belongs to.
   *
   * Idempotent, and silent when the cookie is missing or already dead: there
   * is nothing useful to tell a caller who asked to end a session that has
   * already ended, and answering differently would say whether a given token
   * was ever real.
   */
  async logout(presentedToken: string | null): Promise<void> {
    if (presentedToken === null || !isWellFormedToken(presentedToken)) return;

    const family = await this.sessions.familyOf(presentedToken);
    if (family === null) return;

    const revoked = await this.sessions.revokeFamily(
      family.familyId,
      SessionService.reasons.LOGOUT,
    );

    this.auditContext.record({
      orgId: family.orgId,
      actorUserId: family.userId,
      action: 'auth.logout',
      entityType: 'session',
      after: { familyId: family.familyId, sessionsRevoked: revoked },
    });
  }

  // ---------------------------------------------------------- invitations

  /** REQ-B-03. Returns the invitation; the token leaves only by email. */
  async createInvitation(
    principal: Principal,
    input: CreateInvitationDto,
  ): Promise<InvitationResult> {
    const existing = await this.findByEmail(input.email);

    if (existing !== null && existing.orgId !== principal.orgId) {
      // The unique index on lower(email) is global. Saying "already exists"
      // would confirm an address in another organisation, so this reads as an
      // ordinary conflict.
      throw AppError.conflict('That email address cannot be invited.');
    }
    if (existing !== null && existing.status === 'ACTIVE') {
      throw AppError.conflict('That email address already has an account.');
    }
    if (existing !== null && existing.status === 'SUSPENDED') {
      throw AppError.conflict('That account is suspended; reactivate it instead of inviting it.');
    }

    if (input.roleIds.length > 0) await this.assertRolesBelongTo(principal.orgId, input.roleIds);

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const result = await this.db.transaction(async (tx) => {
      const userId = await this.upsertInvitedUser(tx, principal, input, existing);

      if (input.roleIds.length > 0) {
        await tx
          .insert(userRoles)
          .values(input.roleIds.map((roleId) => ({ userId, roleId, createdBy: principal.userId })))
          .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] });
      }

      // A resend must not leave the previous link working: REQ-B-03 allows
      // resend and revoke, and two live tokens for one account is one more
      // than the requirement permits.
      await tx
        .update(invitations)
        .set({ revokedAt: new Date(), updatedBy: principal.userId })
        .where(
          and(
            eq(invitations.orgId, principal.orgId),
            sql`lower(${invitations.email}) = ${input.email}`,
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            isNull(invitations.deletedAt),
          ),
        );

      const rows = await tx
        .insert(invitations)
        .values({
          orgId: principal.orgId,
          email: input.email,
          employeeId: input.employeeId ?? null,
          tokenHash: this.hashInvitationToken(token),
          expiresAt,
          invitedBy: principal.userId,
          createdBy: principal.userId,
          updatedBy: principal.userId,
        })
        .returning({ id: invitations.id });

      const row = rows[0];
      if (row === undefined) throw new Error('Invitation insert returned no row.');
      return { invitationId: row.id, userId };
    });

    await this.mailer.send({
      to: input.email,
      subject: 'You have been invited to Vyuha',
      body:
        'An administrator has created an account for you. Follow the link to set a password. ' +
        'The link can be used once and expires in 72 hours.',
      actionUrl: `${env.WEB_BASE_URL}/accept-invitation/${token}`,
    });

    this.auditContext.record({
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: result.invitationId,
      after: { email: input.email, userId: result.userId, expiresAt: expiresAt.toISOString() },
    });

    return {
      id: result.invitationId,
      userId: result.userId,
      email: input.email,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async upsertInvitedUser(
    tx: Transaction,
    principal: Principal,
    input: CreateInvitationDto,
    existing: { id: string } | null,
  ): Promise<string> {
    if (existing !== null) {
      await tx
        .update(users)
        .set({
          employeeId: input.employeeId ?? null,
          updatedAt: new Date(),
          updatedBy: principal.userId,
        })
        .where(eq(users.id, existing.id));
      return existing.id;
    }

    const rows = await tx
      .insert(users)
      .values({
        orgId: principal.orgId,
        email: input.email,
        employeeId: input.employeeId ?? null,
        // No password until the invitation is accepted. `passwordHash` stays
        // null and `verifyPassword` treats null as "does not verify", so an
        // unaccepted account cannot be logged into by any password.
        status: 'INVITED',
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning({ id: users.id });

    const row = rows[0];
    if (row === undefined) throw new Error('User insert returned no row.');
    return row.id;
  }

  /** REQ-B-03: single use. Sets the password and activates the account. */
  async acceptInvitation(token: string, password: string): Promise<{ userId: string; email: string }> {
    if (!isWellFormedToken(token)) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This invitation link is not valid.');
    }

    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, this.hashInvitationToken(token)))
      .limit(1);

    const invitation = rows[0];
    if (invitation === undefined) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This invitation link is not valid.');
    }
    if (invitation.acceptedAt !== null) {
      throw new AppError(
        ERROR_CODES.INVITATION_ALREADY_ACCEPTED,
        'This invitation has already been used.',
      );
    }
    if (invitation.revokedAt !== null) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This invitation has been withdrawn.');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        ERROR_CODES.INVITATION_EXPIRED,
        'This invitation has expired. Ask for a new one.',
      );
    }

    assertPasswordAcceptable(password, invitation.email);
    const passwordHash = await hashPassword(password);

    const user = await this.findByEmail(invitation.email);
    if (user === null || user.orgId !== invitation.orgId) {
      // The invitation exists but its account does not, which can only happen
      // if the user row was deleted after the invitation was issued.
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This invitation is no longer valid.');
    }

    const accepted = await this.db.transaction(async (tx) => {
      // Conditional, so two clicks on the same link cannot both succeed. The
      // row count is the single-use enforcement, not the read above it.
      const claimed = await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });

      if (claimed.length === 0) return false;

      const now = new Date();
      await tx
        .update(users)
        .set({
          passwordHash,
          status: 'ACTIVE',
          passwordChangedAt: now,
          failedAttempts: 0,
          failedAttemptsSince: null,
          lockedUntil: null,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(users.id, user.id));

      return true;
    });

    if (!accepted) {
      throw new AppError(
        ERROR_CODES.INVITATION_ALREADY_ACCEPTED,
        'This invitation has already been used.',
      );
    }

    this.auditContext.record({
      orgId: invitation.orgId,
      actorUserId: user.id,
      action: 'invitation.accepted',
      entityType: 'user',
      entityId: user.id,
      before: { status: 'INVITED' },
      after: { status: 'ACTIVE' },
    });

    return { userId: user.id, email: user.email };
  }

  // ------------------------------------------------------- password reset

  /**
   * REQ-B-04. Always succeeds from the caller's point of view: answering
   * differently for an unknown address turns this endpoint into a way to
   * enumerate every account in the organisation.
   */
  async requestPasswordReset(email: string, ip: string | null): Promise<void> {
    const user = await this.findByEmail(email);

    if (user === null || user.status !== 'ACTIVE') {
      this.logger.log({ msg: 'Password reset requested for an address with no active account' });
      return;
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.db.insert(passwordResets).values({
      orgId: user.orgId,
      userId: user.id,
      tokenHash: this.hashResetToken(token),
      expiresAt,
      requestedIp: ip,
    });

    await this.mailer.send({
      to: user.email,
      subject: 'Reset your Vyuha password',
      body: 'Follow the link to choose a new password. It can be used once and expires in 30 minutes.',
      actionUrl: `${env.WEB_BASE_URL}/reset-password/${token}`,
    });

    this.auditContext.record({
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'password_reset.requested',
      entityType: 'user',
      entityId: user.id,
      after: { expiresAt: expiresAt.toISOString() },
    });
  }

  /** REQ-B-04: single use, and it invalidates every other session. */
  async confirmPasswordReset(token: string, password: string): Promise<{ userId: string }> {
    if (!isWellFormedToken(token)) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This reset link is not valid.');
    }

    const rows = await this.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.tokenHash, this.hashResetToken(token)))
      .limit(1);

    const reset = rows[0];
    if (reset === undefined) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This reset link is not valid.');
    }
    if (reset.usedAt !== null) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This reset link has already been used.');
    }
    if (reset.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'This reset link has expired.');
    }

    const userRows = await this.db
      .select({ id: users.id, email: users.email, orgId: users.orgId })
      .from(users)
      .where(and(eq(users.id, reset.userId), isNull(users.deletedAt)))
      .limit(1);

    const user = userRows[0];
    if (user === undefined) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This reset link is no longer valid.');
    }

    assertPasswordAcceptable(password, user.email);
    const passwordHash = await hashPassword(password);

    const claimed = await this.db.transaction(async (tx) => {
      const marked = await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)))
        .returning({ id: passwordResets.id });

      if (marked.length === 0) return false;

      const now = new Date();
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: now,
          failedAttempts: 0,
          failedAttemptsSince: null,
          lockedUntil: null,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(users.id, user.id));

      // Any other outstanding reset link is now stale. Leaving them live would
      // mean a stolen link still works after the theft was noticed and undone.
      await tx
        .update(passwordResets)
        .set({ usedAt: now })
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

      return true;
    });

    if (!claimed) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This reset link has already been used.');
    }

    // REQ-B-04: "Password change invalidates all other sessions." Access
    // tokens already in flight are handled separately, by PrincipalService
    // comparing their `iat` against `password_changed_at`.
    const revoked = await this.sessions.revokeAllForUser(
      user.id,
      SessionService.reasons.PASSWORD_CHANGED,
    );

    this.auditContext.record({
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'password_reset.completed',
      entityType: 'user',
      entityId: user.id,
      after: { sessionsRevoked: revoked },
    });

    return { userId: user.id };
  }

  // ------------------------------------------------------------------- me

  async me(principal: Principal): Promise<MeResponse> {
    const employee = await this.loadEmployee(principal);

    return {
      user: {
        id: principal.userId,
        email: principal.email,
        status: principal.status,
        employeeId: principal.employeeId,
      },
      employee,
      roles: principal.roles,
      permissions: [...principal.permissions].sort(),
    };
  }

  private async loadEmployee(principal: Principal): Promise<MeResponse['employee']> {
    if (principal.employeeId === null) return null;

    const rows = await this.db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        departmentId: employees.departmentId,
        locationId: employees.locationId,
        reportingManagerId: employees.reportingManagerId,
      })
      .from(employees)
      .where(
        and(
          eq(employees.id, principal.employeeId),
          eq(employees.orgId, principal.orgId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  // -------------------------------------------------------------- helpers

  /**
   * REQ-B-01 matches on the work email. The unique index is on
   * `lower(email) WHERE deleted_at IS NULL`, so the predicate is written to
   * match it exactly -- `ilike` or a Node-side lower-case would not use it.
   */
  private async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async assertRolesBelongTo(orgId: string, roleIds: readonly string[]): Promise<void> {
    const found = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), inArray(roles.id, [...roleIds]), isNull(roles.deletedAt)));

    if (found.length === roleIds.length) return;

    const known = new Set(found.map((row) => row.id));
    throw AppError.validation('One or more roles do not exist in this organisation.', {
      roleIds: roleIds.filter((id) => !known.has(id)),
    });
  }

  private hashInvitationToken(token: string): string {
    return hashOpaqueToken(TOKEN_PURPOSES.INVITATION, token, env.JWT_REFRESH_SECRET);
  }

  private hashResetToken(token: string): string {
    return hashOpaqueToken(TOKEN_PURPOSES.PASSWORD_RESET, token, env.JWT_REFRESH_SECRET);
  }

  private accessResponse(
    orgId: string,
    userId: string,
    email: string,
    sessionId: string,
  ): LoginResponse {
    return {
      accessToken: signAccessToken({
        userId,
        orgId,
        sessionId,
        ttlSeconds: env.JWT_ACCESS_TTL_SECONDS,
        secret: env.JWT_ACCESS_SECRET,
      }),
      tokenType: 'Bearer',
      expiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
      user: { id: userId, email },
    };
  }
}
