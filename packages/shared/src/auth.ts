import { z } from 'zod';

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
