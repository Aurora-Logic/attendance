import { ROLE_PERMISSION_MATRIX, SYSTEM_ROLES, type SystemRoleName } from '@vyuha/shared';

import type { RolesResponse } from './types';

/**
 * The four seeded roles, shown when `GET /roles` is not deployed yet.
 *
 * Built from `ROLE_PERMISSION_MATRIX` rather than invented, so the matrix on
 * screen is the matrix the seed actually writes (PRD §2.1). An invented sample
 * here would teach the reader a permission split that does not exist, which is
 * the specific harm the sample-data notice is meant to prevent -- and a notice
 * cannot undo a wrong number that somebody has already believed.
 *
 * Member counts are the one thing that cannot be derived, so they are zero
 * rather than plausible. A made-up headcount is exactly the kind of figure
 * somebody quotes in a meeting.
 */

const DESCRIPTIONS: Record<SystemRoleName, string> = {
  Employee: 'Punch, see own attendance, apply for leave, raise a regularization.',
  Operations: "Approve the team's leave and regularizations, see team attendance, manage rosters.",
  HR: 'Organisation-wide attendance, leave policy, employee records, period lock, exports.',
  Admin: 'Everything, plus settings, roles, the audit log and integrations.',
};

export function sampleRoles(): RolesResponse {
  const names = Object.values(SYSTEM_ROLES);

  return {
    data: names.map((name, index) => ({
      id: `sample-role-${String(index + 1)}`,
      name,
      description: DESCRIPTIONS[name],
      isSystem: true,
      permissions: [...ROLE_PERMISSION_MATRIX[name]],
      memberCount: 0,
    })),
  };
}
