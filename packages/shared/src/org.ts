import { z } from 'zod';

import type { AgentCondition } from './sync.js';

import type { IntegrationStatus, IntegrationSystem } from './enums.js';
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

// ---------------------------------------------------------------------------
// Admin operations (REQ-B-09a, REQ-M-04)
//
// "Every Admin CRUD action writes an audit entry with before/after values and
// the acting user" — and every destructive or overriding one takes a typed
// reason first. The schema lives here rather than in each module so a new
// destructive route cannot ship with a laxer definition of "a reason".
// ---------------------------------------------------------------------------

/**
 * Long enough to be a sentence, not a keystroke.
 *
 * The failure this guards against is not a missing field — Zod would catch
 * that — it is the field that is present and says "x". Ten characters is the
 * shortest thing that can carry a why ("duplicate", "wrong year"), and the
 * client shows the same floor so the refusal is not a surprise from the server.
 */
export const MIN_ADMIN_REASON = 10;
export const MAX_ADMIN_REASON = 500;

export const adminReasonSchema = z
  .string()
  .trim()
  .min(MIN_ADMIN_REASON, `a reason of at least ${String(MIN_ADMIN_REASON)} characters is required`)
  .max(MAX_ADMIN_REASON);

/** Every destructive or restoring action carries the same body. */
export const reasonBodySchema = z.object({ reason: adminReasonSchema });

export type ReasonBody = z.infer<typeof reasonBodySchema>;

/**
 * The masters that support soft delete and restore (REQ-M-04, PRD §4.B).
 *
 * The list is the contract, not a convenience: the recycle bin, the delete
 * route and the permission lookup all resolve an entity type against it, and
 * anything not named here has no delete route at all rather than a delete route
 * that quietly does nothing.
 */
export const SOFT_DELETABLE_ENTITIES = [
  'department',
  'designation',
  'location',
  'shift',
  'leaveType',
  'holidayCalendar',
  /** REQ-B-07 / REQ-B-09a. Seeded roles refuse the delete; custom ones do not. */
  'role',
] as const;

export type SoftDeletableEntity = (typeof SOFT_DELETABLE_ENTITIES)[number];

export const softDeletableEntitySchema = z.enum(SOFT_DELETABLE_ENTITIES);

/**
 * One row that still points at the record somebody is trying to delete.
 *
 * `label` names the row, not the table. "In use" tells an administrator to go
 * and look; "in use by Asha Menon and 4 others" tells them what to do about it.
 */
export interface BlockingReference {
  readonly entityType: string;
  readonly label: string;
  /** Rows of this kind that point at the record, including any beyond `label`. */
  readonly count: number;
  /** Up to a handful of names, so the message can be specific without being long. */
  readonly examples: readonly string[];
}

export interface RecycleBinEntry {
  readonly entityType: SoftDeletableEntity;
  /** "Department", "Leave type" — for a screen that lists several kinds at once. */
  readonly entityLabel: string;
  readonly id: string;
  readonly name: string;
  /** Masters keyed by a code show it; holiday calendars have none. */
  readonly code: string | null;
  readonly deletedAt: string;
  readonly deletedBy: NamedRef | null;
  readonly reason: string | null;
}

// ---------------------------------------------------------------------------
// REQ-L-01: the organisation logo (OPEN-QUESTIONS P0-7)
//
// It lived in localStorage while there was no file service to put it in, which
// meant a second person signing in saw the monogram. Its permanent home is
// `organizations.logo_key` pointing at a row in `files`, and it is read back
// through a short-lived signed URL like every other object (NFR-09).
// ---------------------------------------------------------------------------

export interface OrgBranding {
  readonly name: string;
  /**
   * A signed URL, or null when no logo is set -- and also null when one is set
   * but its object has gone. A broken image in the sidebar of every screen
   * would be a worse answer than the monogram.
   */
  readonly logoUrl: string | null;
  /** How long the URL above is good for, so a client can decide when to refetch. */
  readonly logoUrlExpiresInSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Technical design §14: the Tally seam, read-only
//
// Phase 0 scope is the tables and the interface, so Phase 6 is additive.
// Nothing syncs, nothing heartbeats yet, and this contract deliberately
// describes only what is true today: which connections exist and what state
// each is in. Creating one, issuing a token and rotating it are credential
// operations with no endpoint behind them, and they are not declared here —
// a field in a contract is a standing invitation for somebody to fill it in.
// ---------------------------------------------------------------------------

export interface IntegrationConnectionView {
  readonly id: string;
  readonly system: IntegrationSystem;
  readonly name: string;
  readonly status: IntegrationStatus;
  /** ISO instant, or null when the agent has never reported in. */
  readonly lastHeartbeatAt: string | null;
  /**
   * True when an agent token has been issued. Never the token, and never its
   * hash — the hash is not selected by any read path in the application.
   */
  readonly tokenIssued: boolean;
  /** The Tally company this connection is bound to, when known (REQ-Q-03). */
  readonly companyName: string | null;
  /**
   * REQ-Q-05: the specific problem the last heartbeat carried, so an ERROR
   * names its fix — "Tally is not running" and "the wrong company is open"
   * are different instructions to the person walking to that machine.
   */
  readonly lastCondition: AgentCondition | null;
}

export interface IntegrationListResponse {
  readonly data: readonly IntegrationConnectionView[];
  /**
   * How long a silence has to last before a connection is called stale, so the
   * screen states the same number the server judged by rather than printing one
   * of its own.
   */
  readonly staleAfterMinutes: number;
}

export const recycleBinQuerySchema = pageQuerySchema.extend({
  entityType: softDeletableEntitySchema.optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

export type RecycleBinQuery = z.infer<typeof recycleBinQuerySchema>;
