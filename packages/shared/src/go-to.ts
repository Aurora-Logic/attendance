import { z } from 'zod';

/**
 * REQ-O-05: Go To searches records, not only screens.
 *
 * The wire shape is deliberately open: `type` is a string rather than a union,
 * so a module that registers a new record source on the server does not need a
 * release of this package before its results can travel. A client that meets a
 * type it does not know simply drops it — the alternative is a shared enum
 * that every module edits, which is the per-module coupling REQ-O-05 forbids.
 */

/** Below this the server answers empty rather than searching. One character matches half the organisation. */
export const GO_TO_QUERY_MIN_LENGTH = 2;

/** Across all sources, after ranking. A palette is not a report; page two of one does not exist. */
export const GO_TO_RESULT_CAP = 15;

/**
 * Per source, before ranking. Keeps one prolific source (ten thousand
 * vouchers, one day) from crowding every other kind out of the cap above.
 */
export const GO_TO_SOURCE_CAP = 8;

export const goToQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
});

export type GoToQuery = z.infer<typeof goToQuerySchema>;

export interface GoToRecord {
  /** Which source produced it — 'employee', later 'party', 'voucher', … */
  readonly type: string;
  readonly id: string;
  /** What the palette prints: a person's name, a party's name, a voucher number. */
  readonly title: string;
  /** Secondary line: code, designation, whatever disambiguates. */
  readonly subtitle: string | null;
  /**
   * The identifier a user types when they mean exactly this record — an
   * employee code, a voucher number. Ranking puts an exact match here above
   * every fuzzier one; null opts out of that tier.
   */
  readonly code: string | null;
}

export interface GoToResponse {
  /** The trimmed query the records answer, so a late response can be matched to what was typed. */
  readonly query: string;
  readonly records: readonly GoToRecord[];
}
