import { z } from 'zod';

import { DUPLICATE_MATCH_FIELDS, DUPLICATE_MATCH_FIELD_LABELS, type DuplicateFlag, type DuplicateMatchField } from '@vyuha/shared';

/**
 * 15 REQ-AO-06/08: the flag a masters row carries when its record sits in an
 * open duplicate cluster, and the shared pieces the list surfaces read from
 * it — the parsed shape, the row tint, the one-sentence warning, and the
 * labels for the fields that matched. Built on the shared `DuplicateFlag`
 * contract so the client and the server can never describe a duplicate two
 * different ways.
 */

/** Parses the `duplicate` field the masters endpoints attach to a party or item row. */
export const duplicateFlagSchema = z.object({
  clusterId: z.string(),
  confidence: z.number(),
  matchedFields: z.array(z.enum(DUPLICATE_MATCH_FIELDS)),
  others: z.array(z.string()),
});

export type FlagLike = DuplicateFlag;

/** The destructive tint a flagged row wears — never the only signal (the badge carries the sentence). */
export const DUPLICATE_ROW_CLASS = 'bg-destructive/5';

/** The human labels for a set of matched fields, in the catalogue's order. */
export function matchedFieldLabels(fields: readonly DuplicateMatchField[]): string[] {
  return DUPLICATE_MATCH_FIELDS.filter((field) => fields.includes(field)).map((field) => DUPLICATE_MATCH_FIELD_LABELS[field]);
}

/** Joins a list with commas and a trailing "and": ["a"]→"a", ["a","b"]→"a and b", ["a","b","c"]→"a, b and c". */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/**
 * The sentence a flagged row proves: which fields it shares, with whom.
 * "Same GSTIN and phone as Asha Traders" — read as the badge's name and
 * its tooltip, so colour is never the only signal (REQ-AO-08).
 */
export function duplicateWarning(flag: FlagLike): string {
  const fields = matchedFieldLabels(flag.matchedFields);
  const shared = fields.length === 0 ? 'details' : andList(fields.map((label) => label.toLowerCase()));
  const others = flag.others;
  const who =
    others.length === 0
      ? 'another record'
      : others.length <= 2
        ? andList(others)
        : `${others[0] ?? ''} and ${String(others.length - 1)} others`;
  return `Same ${shared} as ${who}`;
}
