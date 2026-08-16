import { describe, expect, it } from 'vitest';

import { filterScreenGroups } from './go-to-filter';
import type { NavGroup } from './nav';

/**
 * The screen half of the palette's matching. Deliberately dumb — substring on
 * labels — so what it promises is narrow enough to hold still.
 */

const NOOP_ICON = (() => null) as unknown as NavGroup['items'][number]['icon'];

function group(label: string, ...itemLabels: string[]): NavGroup {
  return {
    label,
    items: itemLabels.map((itemLabel) => ({
      to: `/${itemLabel.toLowerCase().replace(/\s+/gu, '-')}`,
      label: itemLabel,
      icon: NOOP_ICON,
      phase: 1,
      reqs: 'test',
    })),
  };
}

const GROUPS: NavGroup[] = [
  group('Work', 'Punch', 'My attendance'),
  group('Workspace', 'Settings', 'Audit log'),
];

describe('filterScreenGroups', () => {
  it('returns everything for an empty term', () => {
    expect(filterScreenGroups('', GROUPS)).toHaveLength(2);
    expect(filterScreenGroups('   ', GROUPS)).toHaveLength(2);
  });

  it('matches item labels case-insensitively and drops empty groups', () => {
    const result = filterScreenGroups('AUDIT', GROUPS);
    expect(result).toHaveLength(1);
    expect(result[0]?.items.map((i) => i.label)).toEqual(['Audit log']);
  });

  it('a group-label match keeps the whole group', () => {
    // "work" hits both the Work group and the Workspace group by name; every
    // item of each survives even though none contains "work" itself.
    const result = filterScreenGroups('work', GROUPS);
    expect(result.map((g) => g.items.length)).toEqual([2, 2]);
  });

  it('finds an item by an inner fragment, not only a prefix', () => {
    const result = filterScreenGroups('attend', GROUPS);
    expect(result[0]?.items.map((i) => i.label)).toEqual(['My attendance']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterScreenGroups('zzz', GROUPS)).toEqual([]);
  });
});
