import { z } from 'zod';

/**
 * REQ-M-03: consent notices whose acceptance the server records, once per
 * user per notice.
 *
 * A closed catalogue rather than a free string, for the reason the settings
 * catalogue gives: an arbitrary-key endpoint would happily record acceptance
 * of notices that do not exist, and the screen that gates on one could never
 * trust the answer. Unknown key is a 400.
 *
 * 'attendance.punch_capture' is the punch screen's photo-and-location notice.
 * The prefix names the module that consumes the row, exactly as setting keys
 * do -- the table itself is platform.
 */
export const CONSENT_KEYS = ['attendance.punch_capture'] as const;

export type ConsentKey = (typeof CONSENT_KEYS)[number];

/**
 * Which revision of each notice's wording is currently shown. Stamped onto the
 * acceptance row (`consent_acceptances.notice_version`), because a row that
 * says only "accepted" cannot answer "accepted *what*" once the wording
 * changes. Bump the number when the notice text changes materially.
 */
export const CONSENT_NOTICE_VERSIONS: Record<ConsentKey, number> = {
  'attendance.punch_capture': 1,
};

export const consentAcceptanceInputSchema = z
  .object({
    consentKey: z.enum(CONSENT_KEYS),
  })
  .strict();

export type ConsentAcceptanceInput = z.infer<typeof consentAcceptanceInputSchema>;

/** What `POST /me/consent` answers: the fact recorded, not the row. */
export interface ConsentAcceptance {
  readonly consentKey: ConsentKey;
  /** ISO instant of the first acceptance; a replay returns the original. */
  readonly acceptedAt: string;
  /** REQ-D-11's convention: true when this call recorded nothing new. */
  readonly replayed: boolean;
}
