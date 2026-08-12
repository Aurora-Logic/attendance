import { z } from 'zod';

import type { NamedRef } from './people.js';
import { pageQuerySchema } from './pagination.js';

/**
 * Departments, designations and locations (REQ-A-01, REQ-A-02) -- the three
 * masters an employee record points at. Same reasoning as `people.ts`: one
 * definition, parsed by the API and reused by the web client's forms.
 */

export interface DepartmentSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly parent: NamedRef | null;
  readonly head: NamedRef | null;
}

export interface DesignationSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly grade: string | null;
}

export interface LocationSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly address: string | null;
  /** Null means the organisation timezone applies. */
  readonly timezone: string | null;
  /**
   * REQ-D-08. Null until the office coordinates are supplied
   * (docs/OPEN-QUESTIONS item 1); geofenced punch stays disabled rather than
   * falling back to a guessed centre.
   */
  readonly geofenceLat: number | null;
  readonly geofenceLng: number | null;
  readonly geofenceRadiusM: number;
  /**
   * REQ-D-09. Empty until the office addresses are supplied (item 3). An empty
   * allowlist blocks web punch; it does not mean "allow everything".
   */
  readonly ipAllowlist: readonly string[];
}

/** Shared by all three masters: unique per organisation, printed on reports. */
const codeField = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u, 'may contain letters, digits, dot, underscore, slash and hyphen');

const nameField = z.string().trim().min(1).max(120);

/**
 * An IANA zone name, checked by asking the platform rather than by matching a
 * pattern. A wrong timezone here does not fail loudly -- it silently shifts
 * every attendance date for that location by a few hours, which is the kind of
 * bug that is found weeks later in a payroll dispute.
 */
const timezoneField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'must be an IANA timezone name, for example Asia/Kolkata');

/** Either a single address or a CIDR block; both forms appear in a real allowlist. */
const ipEntryField = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

export const MASTER_SORT_FIELDS = ['name', 'code'] as const;
export type MasterSortField = (typeof MASTER_SORT_FIELDS)[number];

export const DEFAULT_MASTER_SORT = 'name';

/** One query shape for all three masters: they are small, flat lists. */
export const masterListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(200).optional(),
});

export type MasterListQuery = z.infer<typeof masterListQuerySchema>;

export const createDepartmentSchema = z.object({
  name: nameField,
  code: codeField,
  /** Must be an employee in this organisation; checked server-side. */
  headEmployeeId: z.uuid().nullish(),
  /** REQ-A-02 hierarchy. Must not close a loop, checked with the same CTE as REQ-A-07. */
  parentId: z.uuid().nullish(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: nameField,
    code: codeField,
    headEmployeeId: z.uuid().nullable(),
    parentId: z.uuid().nullable(),
  })
  .partial();

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createDesignationSchema = z.object({
  name: nameField,
  code: codeField,
  grade: z.string().trim().min(1).max(32).nullish(),
});

export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = z
  .object({
    name: nameField,
    code: codeField,
    grade: z.string().trim().min(1).max(32).nullable(),
  })
  .partial();

export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;

/**
 * The geofence and allowlist fields are accepted but have no answer yet, so
 * nothing seeds or defaults them. A radius is the one exception: the column is
 * NOT NULL with a 100 m default, and a radius without a centre does nothing.
 */
export const createLocationSchema = z.object({
  name: nameField,
  code: codeField,
  address: z.string().trim().min(1).max(500).nullish(),
  timezone: timezoneField.nullish(),
  geofenceLat: z.number().min(-90).max(90).nullish(),
  geofenceLng: z.number().min(-180).max(180).nullish(),
  geofenceRadiusM: z.number().int().min(10).max(10_000).default(100),
  ipAllowlist: z.array(ipEntryField).max(50).default([]),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    name: nameField,
    code: codeField,
    address: z.string().trim().min(1).max(500).nullable(),
    timezone: timezoneField.nullable(),
    geofenceLat: z.number().min(-90).max(90).nullable(),
    geofenceLng: z.number().min(-180).max(180).nullable(),
    geofenceRadiusM: z.number().int().min(10).max(10_000),
    ipAllowlist: z.array(ipEntryField).max(50),
  })
  .partial();

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
