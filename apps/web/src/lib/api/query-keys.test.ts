import { describe, expect, it } from 'vitest';

/**
 * Two hooks caching different shapes under one query key silently poison each
 * other: whichever fetches first wins, staleTime keeps the winner fresh, and
 * the losing screen crashes on a shape it never fetched. That is not a
 * hypothetical - ['departments', 'options'] was cached as a plain
 * DepartmentOption[] by the employees feature and as a Sampled envelope by the
 * attendance feature, and walking from Employees to Team Attendance threw
 * "Cannot read properties of undefined (reading 'data')".
 *
 * TanStack Query cannot catch this - sharing a key is legal and sometimes
 * wanted - so this scan enforces the repo's rule instead: every statically
 * written `queryKey:` registration must be unique. Deliberate sharing belongs
 * in one exported hook, not in two files that happen to agree on a key today.
 *
 * Scope and limits, stated so a failure here is quick to read:
 * - Only single-line `queryKey: [...]` registrations are seen. Invalidations
 *   (`invalidateQueries` and friends) are exempt - prefix matching is their
 *   entire point.
 * - Non-literal elements (params objects, spreads, variables) count as one
 *   wildcard position; keys with no literal at all are skipped, since two of
 *   those cannot be told apart from source text.
 */

// Raw source, through the same pipeline the build uses - no node:fs, so the
// test stays inside the app tsconfig's type surface.
const SOURCES: Record<string, string> = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** ['departments', 'list', params] -> "departments,list,*" */
function signature(elements: string): string | null {
  const parts = elements
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const literal = /^['"`]([^'"`]*)['"`]$/.exec(part);
      return literal ? literal[1] : '*';
    });
  if (!parts.some((part) => part !== '*')) return null;
  return parts.join(',');
}

const REGISTRATION = /queryKey:\s*\[([^\]\n]*)\]/;
const EXEMPT = /invalidateQueries|setQueryData|getQueryData|removeQueries|cancelQueries/;

describe('query key registrations', () => {
  it('no two useQuery registrations share a static key', () => {
    const seen = new Map<string, string[]>();

    for (const [file, source] of Object.entries(SOURCES)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      source.split('\n').forEach((line, index) => {
        if (EXEMPT.test(line)) return;
        const match = REGISTRATION.exec(line);
        if (!match) return;
        const sig = signature(match[1] ?? '');
        if (sig === null) return;
        const where = `${file}:${String(index + 1)}`;
        seen.set(sig, [...(seen.get(sig) ?? []), where]);
      });
    }

    const collisions = [...seen.entries()].filter(([, places]) => places.length > 1);
    expect(
      collisions,
      collisions
        .map(([sig, places]) => `key [${sig}] is registered in: ${places.join(', ')}`)
        .join('\n'),
    ).toEqual([]);

    // The scan has to have seen the real registrations, or a green run proves
    // nothing - guard against the regex rotting when the codebase moves.
    expect(seen.size).toBeGreaterThan(20);
  });
});
