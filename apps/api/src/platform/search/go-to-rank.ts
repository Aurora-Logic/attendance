import type { GoToRecord } from '@vyuha/shared';

/**
 * Cross-source ranking for Go To (REQ-O-05).
 *
 * The tiers encode one promise from the delivery plan: "typing an employee
 * code opens that employee". Opening means being first, so an exact code
 * match must beat every fuzzier match from every other source — a person
 * typing `VY-0003` is not browsing.
 *
 * Ties keep their incoming order inside a tier rather than being re-sorted
 * alphabetically: each source already answered in its own relevance order,
 * and alphabetising would throw that away for the false neutrality of the
 * letter A.
 */

const enum Tier {
  ExactCode = 0,
  CodePrefix = 1,
  TitlePrefix = 2,
  WordStart = 3,
  Elsewhere = 4,
}

function tierOf(term: string, record: GoToRecord): Tier {
  const code = record.code?.toLowerCase() ?? null;
  const title = record.title.toLowerCase();

  if (code !== null) {
    if (code === term) return Tier.ExactCode;
    if (code.startsWith(term)) return Tier.CodePrefix;
  }
  if (title.startsWith(term)) return Tier.TitlePrefix;
  // "men" should rank "Asha Menon" above "Clement Rao": a person types the
  // start of some word they know, not an arbitrary infix.
  if (title.includes(` ${term}`)) return Tier.WordStart;
  return Tier.Elsewhere;
}

export function rankGoToRecords(rawTerm: string, records: readonly GoToRecord[]): GoToRecord[] {
  const term = rawTerm.trim().toLowerCase();
  return records
    .map((record, index) => ({ record, index, tier: tierOf(term, record) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.record);
}
