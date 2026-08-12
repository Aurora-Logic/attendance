import { z } from 'zod';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { MIN_PASSWORD_LENGTH } from './password-policy.js';

/**
 * Every request body on the auth surface. Definition of Done: "Zod schema
 * validates every request body."
 *
 * The password field is validated for *shape* here and for *strength* in
 * `password-policy.ts`. Splitting them is deliberate: the shape rule keeps a
 * megabyte of text out of scrypt, while the strength rule produces
 * PASSWORD_TOO_WEAK with the specific rule that failed, which a generic
 * VALIDATION_FAILED from a pipe could not.
 */

/** RFC 5321 caps a path at 256 octets; 254 is the practical maximum address. */
const emailField = z
  .email('must be an email address')
  .max(254)
  .transform((value) => value.trim().toLowerCase());

/**
 * Only an upper bound. A short password is rejected by the policy, not here,
 * so the user is told *why* rather than being handed a field-level complaint.
 * The cap exists because scrypt's cost is linear in input length.
 */
const passwordField = z.string().min(1).max(1024);

const newPasswordField = z.string().min(1).max(1024);

export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});
export class LoginDto extends createZodDto(loginSchema) {}

export const createInvitationSchema = z.object({
  email: emailField,
  /** REQ-B-02: an invitation may or may not be tied to an employee record. */
  employeeId: z.uuid().nullish(),
  /** REQ-B-07: multiple roles per user. Empty means no role until assigned. */
  roleIds: z.array(z.uuid()).max(20).default([]),
});
export class CreateInvitationDto extends createZodDto(createInvitationSchema) {}

export const acceptInvitationSchema = z.object({
  password: newPasswordField,
});
export class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}

export const requestPasswordResetSchema = z.object({
  email: emailField,
});
export class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}

export const confirmPasswordResetSchema = z.object({
  password: newPasswordField,
});
export class ConfirmPasswordResetDto extends createZodDto(confirmPasswordResetSchema) {}

export interface LoginResponse {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresInSeconds: number;
  readonly user: { readonly id: string; readonly email: string };
}

export interface MeResponse {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly status: string;
    readonly employeeId: string | null;
  };
  readonly employee: {
    readonly id: string;
    readonly employeeCode: string;
    readonly firstName: string;
    readonly lastName: string | null;
    readonly departmentId: string | null;
    readonly locationId: string | null;
    readonly reportingManagerId: string | null;
  } | null;
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  /** Technical design §10: "`/me` returns the effective permission set." */
  readonly permissions: readonly string[];
}

/** Minimum password length, echoed so the web client shows one number, not two. */
export const PASSWORD_RULES = { minLength: MIN_PASSWORD_LENGTH } as const;
