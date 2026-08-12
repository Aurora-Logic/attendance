import { uuidv7, type PermissionKey } from '@vyuha/shared';

import type { Principal } from '../platform/rbac/principal.js';

/**
 * A principal for a service test that does not go through the guard.
 *
 * Only for services reached directly. Anything with an HTTP surface is tested
 * through `ApiHarness` with a real token, because the guard resolving a
 * principal from the database is part of what those tests exist to prove.
 */
export function principalFixture(input: {
  userId: string;
  orgId: string;
  permissions?: readonly PermissionKey[];
  employeeId?: string | null;
  email?: string;
}): Principal {
  return {
    userId: input.userId,
    orgId: input.orgId,
    employeeId: input.employeeId ?? null,
    email: input.email ?? 'fixture@vyuha.test',
    status: 'ACTIVE',
    sessionId: uuidv7(),
    roles: [],
    permissions: new Set(input.permissions ?? []),
  };
}
