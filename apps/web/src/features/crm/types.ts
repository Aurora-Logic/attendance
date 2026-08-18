import { z } from 'zod';

/**
 * What `/crm/contacts` and `/crm/companies` answer (REQ-U-01, REQ-U-02),
 * parsed at the boundary like every other feed. The shared package's views
 * are the contract; these schemas are the check that the server kept it.
 */

export const contactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  designation: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;

export const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  partyId: z.string().nullable(),
  contactCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Company = z.infer<typeof companySchema>;

const pageMetaSchema = z.object({ page: z.number(), pageSize: z.number(), total: z.number() });

export const contactsResponseSchema = z.object({ data: z.array(contactSchema), meta: pageMetaSchema });
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;

export const companiesResponseSchema = z.object({ data: z.array(companySchema), meta: pageMetaSchema });
export type CompaniesResponse = z.infer<typeof companiesResponseSchema>;

/** REQ-U-08: what the form is warned with, not the record itself. */
export const contactDuplicateSchema = z.object({
  id: z.string(),
  name: z.string(),
  companyName: z.string().nullable(),
  ownerName: z.string().nullable(),
  matchedOn: z.array(z.enum(['phone', 'email'])),
});
export type ContactDuplicate = z.infer<typeof contactDuplicateSchema>;
export const contactDuplicatesSchema = z.array(contactDuplicateSchema);

/** The form's working copy of a contact; ids are null until chosen. */
export interface ContactDraft {
  id?: string;
  name: string;
  phone: string;
  email: string;
  designation: string;
  companyId: string | null;
  ownerId: string | null;
  source: string;
  notes: string;
}

export interface CompanyDraft {
  id?: string;
  name: string;
  phone: string;
  email: string;
  website: string;
  city: string;
  ownerId: string | null;
  notes: string;
}

export function emptyContactDraft(overrides: Partial<ContactDraft> = {}): ContactDraft {
  return {
    name: '',
    phone: '',
    email: '',
    designation: '',
    companyId: null,
    ownerId: null,
    source: '',
    notes: '',
    ...overrides,
  };
}

export function contactToDraft(contact: Contact): ContactDraft {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    designation: contact.designation ?? '',
    companyId: contact.companyId,
    ownerId: contact.ownerId,
    source: contact.source ?? '',
    notes: contact.notes ?? '',
  };
}

export function emptyCompanyDraft(): CompanyDraft {
  return { name: '', phone: '', email: '', website: '', city: '', ownerId: null, notes: '' };
}

export function companyToDraft(company: Company): CompanyDraft {
  return {
    id: company.id,
    name: company.name,
    phone: company.phone ?? '',
    email: company.email ?? '',
    website: company.website ?? '',
    city: company.city ?? '',
    ownerId: company.ownerId,
    notes: company.notes ?? '',
  };
}
