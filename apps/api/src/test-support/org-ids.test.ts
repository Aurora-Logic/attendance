import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Two test files must never claim the same organisation.
 *
 * `ApiHarness.start` truncates the organisation it is handed -- users, roles,
 * employees, the masters they point at -- so two files sharing an id delete
 * each other's fixtures. What makes it worth a test rather than a convention is
 * how it fails: `fileParallelism` is false, so each file passes on its own and
 * only the second one to run inside the suite goes red, with an error about a
 * foreign key rather than about a collision.
 *
 * That is exactly how it was found. `employee-access.endpoints.test.ts` was
 * written with `…e7`, which the reports suite already owned; those employees
 * have punched, `punches.employee_id` is RESTRICT and `punches` is append-only,
 * so the employee wipe failed and the whole file errored out in `beforeAll`.
 * Isolated: 15 passed. In the suite: dead.
 *
 * The two pre-existing sharers are grandfathered by name below rather than
 * silently permitted. Both pairs are attendance fixtures that happen not to
 * collide today, and neither is this change's to fix -- but a new one should
 * not be able to join them.
 */

/**
 * `process.cwd()`, not `import.meta.url`: this package compiles to CommonJS and
 * `tsc` refuses the meta-property under that module setting, so a path derived
 * from it typechecks nowhere. Vitest runs with the package root as its working
 * directory, and the assertion below fails loudly if that ever stops being true
 * rather than scanning an empty directory and passing.
 */
const API_SRC = join(process.cwd(), 'src');
const SEED_DIR = join(process.cwd(), 'seed');

/**
 * Pairs that already shared an id before this check existed. Each entry is the
 * id and the files that hold it; adding to this list is a deliberate act.
 */
const GRANDFATHERED: ReadonlyMap<string, number> = new Map([
  // attendance-day-visibility + leave.endpoints
  ['01900000-0000-7000-8000-0000000000e1', 2],
  // holiday.endpoints + leave-jobs
  ['01900000-0000-7000-8000-0000000000e2', 2],
  // consent.endpoints + file.service. Found by this check on its first run,
  // which is the argument for having written it: three collisions were already
  // in the tree and nobody knew, because none of them has bitten yet.
  ['01900000-0000-7000-8000-0000000000f1', 2],
]);

/**
 * Any `const …ORG_ID = '<uuid>'`, not just the two exact names. The gap was
 * found the expensive way: `seed/seed.test.ts` declares `TEST_ORG_ID`, this
 * pattern matched only `ORG_ID` and `OTHER_ORG_ID`, and the scan below only
 * walked `src/` — so a new endpoint suite picked the seed's id in good faith,
 * its four fixture employees leaked into the seed's org-scoped counts, and
 * three seed assertions failed with numbers that named no cause.
 */
const DECLARATION = /const\s+\w*ORG_ID\s*=\s*'([0-9a-fA-F-]{36})'/gu;

function testFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...testFilesUnder(path));
    } else if (entry.endsWith('.test.ts')) {
      found.push(path);
    }
  }
  return found;
}

function claimsByOrgId(): Map<string, string[]> {
  const claims = new Map<string, string[]>();

  // Both test roots. vitest.config includes `seed/**/*.test.ts` alongside
  // `src/**/*.test.ts`, and a scan that covers less than the runner does is
  // exactly how the seed's organisation got claimed twice.
  for (const root of [API_SRC, SEED_DIR]) {
    for (const file of testFilesUnder(root)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DECLARATION)) {
        const id = match[1]?.toLowerCase();
        if (id === undefined) continue;
        const holders = claims.get(id) ?? [];
        holders.push(file.slice(root.length + 1));
        claims.set(id, holders);
      }
    }
  }

  return claims;
}

describe('test fixture organisations', () => {
  const claims = claimsByOrgId();

  it('finds the declarations at all, so a green run is not an empty scan', () => {
    // Two ways this check can go blind and pass: the working directory moves,
    // or the pattern stops matching after a rename. Neither can report a
    // collision, so both fail here instead.
    expect(existsSync(API_SRC), `${API_SRC} is not a directory`).toBe(true);
    expect(existsSync(SEED_DIR), `${SEED_DIR} is not a directory`).toBe(true);
    expect(claims.size).toBeGreaterThan(20);
    // The seed suite's own ids, by name — the proof the widened pattern and
    // the second root actually see the file this check went blind on.
    expect(claims.get('01900000-0000-7000-8000-0000000000b9')).toEqual(['seed.test.ts']);
  });

  it('gives every test file an organisation of its own', () => {
    const shared = [...claims]
      .filter(([id, holders]) => holders.length > (GRANDFATHERED.get(id) ?? 1))
      .map(([id, holders]) => `${id} claimed by ${holders.join(', ')}`);

    expect(
      shared,
      'ApiHarness.start truncates the organisation it is given, so two files ' +
        'sharing one delete each other\'s fixtures. Pick an unused id.',
    ).toEqual([]);
  });

  it('still has the grandfathered pairs it says it has', () => {
    // Stops the exemption list outliving what it exempts: a file that moved to
    // its own id should have its entry removed, not left behind as a licence
    // for the next collision.
    for (const [id, expected] of GRANDFATHERED) {
      expect(claims.get(id)?.length, `${id} is grandfathered for ${String(expected)} files`).toBe(
        expected,
      );
    }
  });
});
