import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * CRM contracts (08 §7, REQ-U-01 to REQ-U-08). Contacts and companies are
 * Vyuha's own records — nothing here is a projection of Tally, and nothing
 * here is ever pushed to it (REQ-U-03: "a prospect who never buys must not
 * become a ledger"). The link to a party arrives at conversion, through
 * `external_refs`, and is read here as `partyId` when it exists.
 */

const nameField = z.string().trim().min(1).max(120);

/** Same shape as an employee's address: RFC 5321's practical maximum, lowered. */
const emailField = z
  .email('must be an email address')
  .max(254)
  .transform((value) => value.trim().toLowerCase());

/**
 * As permissive as an employee's mobile (REQ-A-06's reasoning holds — a
 * number typed from a business card carries spaces, brackets and a code).
 * The duplicate check (REQ-U-08) compares `normalizePhone`, not the text.
 */
const phoneField = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^[+0-9][0-9 ()-]*$/u, 'may contain digits, spaces, brackets and a leading plus');

const websiteField = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}([/?#].*)?$/u, 'must be a domain or a URL without its scheme');

/**
 * Digits only, with a leading country code folded away when the number is
 * long enough to carry one. `+91 98765 43210`, `098765 43210` and
 * `9876543210` are the same phone; two contacts with two of those spellings
 * are the duplicate REQ-U-08 wants surfaced.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/gu, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export const CONTACT_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];
export const DEFAULT_CONTACT_SORT = 'name';

export const COMPANY_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export type CompanySortField = (typeof COMPANY_SORT_FIELDS)[number];
export const DEFAULT_COMPANY_SORT = 'name';

// ------------------------------------------------------------------ companies

export interface CompanyView {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly city: string | null;
  readonly notes: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  /** The Tally party this company was linked to on conversion (REQ-U-03), else null. */
  readonly partyId: string | null;
  readonly contactCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const companyListQuerySchema = pageQuerySchema.extend({
  /** Free text over name, city and website. */
  q: z.string().trim().min(1).max(80).optional(),
  ownerId: z.uuid().optional(),
  sort: z.string().max(200).optional(),
});
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;

export const createCompanySchema = z.object({
  name: nameField,
  phone: phoneField.nullish(),
  email: emailField.nullish(),
  website: websiteField.nullish(),
  city: z.string().trim().min(1).max(80).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  /** Defaults to the caller's own employee record; only a `view.all` holder may name another. */
  ownerId: z.uuid().nullish(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema.partial();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

// ------------------------------------------------------------------- contacts

export interface ContactView {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly designation: string | null;
  readonly companyId: string | null;
  readonly companyName: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly source: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const contactListQuerySchema = pageQuerySchema.extend({
  /** Free text over name, phone, email and designation. */
  q: z.string().trim().min(1).max(80).optional(),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  sort: z.string().max(200).optional(),
});
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;

export const createContactSchema = z.object({
  name: nameField,
  phone: phoneField.nullish(),
  email: emailField.nullish(),
  designation: z.string().trim().min(1).max(80).nullish(),
  companyId: z.uuid().nullish(),
  /** Defaults to the caller's own employee record; only a `view.all` holder may name another. */
  ownerId: z.uuid().nullish(),
  /** Free text — "referral", "website", an exhibition's name. Not an enum yet: no list was agreed. */
  source: z.string().trim().min(1).max(60).nullish(),
  notes: z.string().trim().max(4000).nullish(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/**
 * REQ-U-08: the duplicate check. Called by the form as phone and email are
 * typed, and answered with the contacts that already carry either — the form
 * shows them and lets the user go ahead anyway. `excludeId` keeps a contact
 * from being reported as its own duplicate while it is being edited.
 */
export const contactDuplicateQuerySchema = z
  .object({
    phone: phoneField.optional(),
    email: emailField.optional(),
    excludeId: z.uuid().optional(),
  })
  .refine((q) => q.phone !== undefined || q.email !== undefined, {
    message: 'phone or email is required',
  });
export type ContactDuplicateQuery = z.infer<typeof contactDuplicateQuerySchema>;

export interface ContactDuplicate {
  readonly id: string;
  readonly name: string;
  readonly companyName: string | null;
  readonly ownerName: string | null;
  /** Which field matched — the form points at the right one. */
  readonly matchedOn: readonly ('phone' | 'email')[];
}
