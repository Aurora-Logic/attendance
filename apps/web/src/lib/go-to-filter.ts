import type { NavGroup } from '@/lib/nav';

/**
 * The screen half of the palette's matching, done by hand because the record
 * half cannot be done by cmdk: server results are already matched to the
 * query, so the list runs with `shouldFilter` off and this supplies what the
 * library would have.
 *
 * Substring on the item label and its group label, case-insensitive. Not
 * fuzzy, deliberately: "lv" finding "Leave types" is clever until "rp" finds
 * three screens the user cannot tell apart. A person who knows the screen
 * types a word from its name; a person who does not is better served by the
 * record index below the screens.
 */
export function filterScreenGroups(rawTerm: string, groups: readonly NavGroup[]): NavGroup[] {
  const term = rawTerm.trim().toLowerCase();
  if (term.length === 0) return [...groups];

  return groups
    .map((group) => {
      const groupMatches = group.label.toLowerCase().includes(term);
      return {
        label: group.label,
        items: groupMatches
          ? group.items
          : group.items.filter((item) => item.label.toLowerCase().includes(term)),
      };
    })
    .filter((group) => group.items.length > 0);
}
