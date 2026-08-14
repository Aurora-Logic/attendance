import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// `fileURLToPath`, not `.pathname`: this repository lives under a directory
// with a space in its name, and a percent-encoded path is not a path.
const API_SRC = fileURLToPath(new URL('..', import.meta.url));

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

const DECLARATION = /const\s+(?:ORG_ID|OTHER_ORG_ID)\s*=\s*'([0-9a-fA-F-]{36})'/gu;

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

  for (const file of testFilesUnder(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(DECLARATION)) {
      const id = match[1].toLowerCase();
      const holders = claims.get(id) ?? [];
      holders.push(file.slice(API_SRC.length));
      claims.set(id, holders);
    }
  }

  return claims;
}

describe('test fixture organisations', () => {
  const claims = claimsByOrgId();

  it('finds the declarations at all, so a green run is not an empty scan', () => {
    // The guard against the regex quietly matching nothing after a rename: a
    // check that cannot see anything cannot report a collision either.
    expect(claims.size).toBeGreaterThan(20);
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
