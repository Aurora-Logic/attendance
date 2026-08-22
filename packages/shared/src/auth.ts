import { z } from 'zod';

import { SYSTEM_ROLES } from './permissions.js';

/**
 * What an administrator gets back when they provision access (REQ-B-03,
 * REQ-B-04).
 *
 * The link is in the response because there is no mail server. `MAIL_TRANSPORT`
 * defaults to `log`, so nothing is delivered unless a deployment turns SMTP on
 * — and an invitation whose link only ever existed inside an email nobody sent
 * is an account that can never be signed into. The administrator holding
 * `employee.manage` is the person who would have been copied on that email
 * anyway; they now hand the link over themselves, by whatever channel they
 * already use.
 *
 * Nothing about the token changes. It is still single-use, still hashed at
 * rest, still 72 hours for an invitation and 30 minutes for a reset, and still
 * revoked by issuing a new one.
 *
 * These schemas are parsed by the web client rather than trusted: the response
 * crosses a network boundary, and a screen that renders `acceptUrl` without
 * checking it is a screen that renders `undefined` into a copy button.
 */

/** REQ-B-03: 72 hours, stated here so the API and the screen cannot disagree. */
export const INVITATION_TTL_HOURS = 72;

/** REQ-B-04: 30 minutes. */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/**
 * REQ-B-01's floor, shared so the form that refuses a short password and the
 * server that refuses it agree on the number.
 *
 * The rest of the policy -- the common-password list, the "not your own email"
 * rule -- stays on the server. A client-side copy would be a list of weak
 * passwords shipped to the browser, and the server's refusal names the rule it
 * applied anyway.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * An `http(s)` URL. `z.string().url()` would accept `javascript:` and
 * `data:`, and this value is put behind a control the reader is invited to
 * open.
 */
const linkField = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      // Not a URL at all. The caller turns this into "the shape this screen
      // cannot read", which is the honest description of what arrived.
      return false;
    }
  }, 'must be an http:// or https:// URL');

export const invitationResultSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  /** ISO instant. The screen says it in words; the value stays machine-readable. */
  expiresAt: z.string(),
  /** Where the invited person sets their password. Carries the single-use token. */
  acceptUrl: linkField,
});

export type InvitationResult = z.infer<typeof invitationResultSchema>;

/**
 * What the invite screen has to know before it offers anything: whether this
 * employee already has a login, and what state it is in.
 *
 * Deliberately not `GET /employees/:id/access`, which answers the same question
 * and more. That endpoint is gated on `roles.manage` -- correctly, because it
 * returns a map of what one named person can do -- and inviting is gated on
 * `employee.manage`. Reading the roles list to decide whether to offer an
 * invitation would have meant HR, the role the feature exists for, opening the
 * dialog and being refused by an endpoint they have no business calling.
 *
 * So this returns one bit and one label, under the permission that already
 * governs the act it informs.
 */
export const signInAccountSchema = z.object({
  employeeId: z.string(),
  account: z
    .object({
      email: z.string(),
      status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']),
      /** REQ-B-09: whether the account has confirmed an authenticator. */
      mfaEnabled: z.boolean().default(false),
    })
    .nullable(),
});

export type SignInAccount = z.infer<typeof signInAccountSchema>;

export const passwordResetLinkSchema = z.object({
  userId: z.string(),
  email: z.string(),
  expiresAt: z.string(),
  /** Where the account holder chooses a new password. Carries the single-use token. */
  resetUrl: linkField,
});

export type PasswordResetLink = z.infer<typeof passwordResetLinkSchema>;

// ---------------------------------------------------------------- REQ-B-09

/**
 * Two-step sign-in with an authenticator app (TOTP, RFC 6238). Owner, 22 Aug
 * 2026: required for Admin and Accounts by default and optional for everyone
 * else, thirty-day trusted browsers, ten one-time recovery codes, an Admin
 * reset. The policy is an organisation setting; these are its values.
 */
export const MFA_POLICIES = ['none', 'admin', 'admin_accounts', 'everyone'] as const;
export type MfaPolicy = (typeof MFA_POLICIES)[number];
export const DEFAULT_MFA_POLICY: MfaPolicy = 'admin_accounts';
export const MFA_POLICY_LABELS: Record<MfaPolicy, string> = {
  none: 'Nobody is required; anyone may turn it on',
  admin: 'Admin',
  admin_accounts: 'Admin and Accounts',
  everyone: 'Everyone',
};

/** Whether a person holding these roles must enrol under a policy. */
export function mfaPolicyRequires(policy: MfaPolicy, roleNames: readonly string[]): boolean {
  switch (policy) {
    case 'none':
      return false;
    case 'everyone':
      return true;
    case 'admin':
      return roleNames.includes(SYSTEM_ROLES.ADMIN);
    case 'admin_accounts':
      return roleNames.includes(SYSTEM_ROLES.ADMIN) || roleNames.includes(SYSTEM_ROLES.ACCOUNTS);
  }
}

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const RECOVERY_CODE_COUNT = 10;
export const TRUSTED_DEVICE_DAYS = 30;
export const MFA_CHALLENGE_TTL_MINUTES = 5;
/** Wrong codes against one challenge before it is spent. */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

/** Six digits, or a recovery code as it was shown: five-five, letters and digits. */
const totpCodeField = z.string().trim().regex(/^\d{6}$/u, 'Enter the six digits from the app.');
const recoveryCodeField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/gu, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/u, 'A recovery code is ten letters and digits.'));
export const mfaCodeSchema = z.union([totpCodeField, recoveryCodeField]);

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(16).max(256),
  code: mfaCodeSchema,
  trustDevice: z.boolean().default(false),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaCodeOnlySchema = z.object({ code: mfaCodeSchema });
export type MfaCodeOnlyInput = z.infer<typeof mfaCodeOnlySchema>;

/** What POST /auth/login answers when the password was right and a code is next. */
export interface MfaChallengeResponse {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly expiresInSeconds: number;
}

export function isMfaChallenge(value: unknown): value is MfaChallengeResponse {
  return typeof value === 'object' && value !== null && (value as { mfaRequired?: unknown }).mfaRequired === true;
}

export interface MfaEnrolmentStart {
  /** Base32, for typing into an app that cannot scan. Shown once. */
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface MfaRecoveryCodes {
  readonly codes: readonly string[];
}

export interface MfaTrustedDeviceView {
  readonly id: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The browser asking is this one. */
  readonly current: boolean;
}

export interface MfaStatus {
  readonly enabled: boolean;
  readonly confirmedAt: string | null;
  /** The organisation's policy requires it of this person's roles. */
  readonly required: boolean;
  readonly recoveryCodesLeft: number;
  readonly trustedDevices: readonly MfaTrustedDeviceView[];
}

/** Carried on /me so the shell can insist on enrolment before anything else. */
export interface MfaSummary {
  readonly enabled: boolean;
  readonly required: boolean;
  readonly enrolmentRequired: boolean;
}

