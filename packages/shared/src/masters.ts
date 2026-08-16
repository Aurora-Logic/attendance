import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * The Tally masters projection, as screens read it (REQ-R-01…R-06, 09 §5).
 *
 * Read-only end to end: there is no create schema in this file and never
 * will be, because REQ-R-04 is permanent — a new customer is created where
 * the accountant creates customers, and appears here on the next pull.
 */

export interface PartyView {
  readonly id: string;
  readonly connectionId: string;
  readonly name: string;
  readonly alias: string | null;
  /** Sundry Debtors / Sundry Creditors, verbatim from Tally's group tree. */
  readonly parentGroup: string;
  readonly gstin: string | null;
  readonly address: string | null;
  /** Exact decimal as text (D-01): Tally's figure, held not computed. */
  readonly creditLimit: string | null;
  readonly creditDays: number | null;
  readonly openingBalance: string | null;
  /** REQ-R-06: gone from Tally, kept here so references keep resolving. */
  readonly absentInTally: boolean;
  /** REQ-Y-07's habit, started early: every projected figure says its age. */
  readonly lastPulledAt: string;
}

export const partyListQuerySchema = pageQuerySchema.extend({
  /** Free text over name, alias and GSTIN. */
  q: z.string().trim().min(1).max(80).optional(),
  /** Filter to one side of the ledger: Sundry Debtors or Sundry Creditors. */
  parentGroup: z.string().trim().min(1).max(120).optional(),
});

export type PartyListQuery = z.infer<typeof partyListQuerySchema>;
