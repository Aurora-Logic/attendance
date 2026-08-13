import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, type PermissionKey } from '@vyuha/shared';
import { z } from 'zod';

/**
 * `GET/POST/PATCH /roles` and `DELETE /masters/role/:id` (REQ-B-07).
 *
 * `permissions` is parsed as the `PermissionKey` union rather than as plain
 * strings. A key the client does not know about is a contract break -- the
 * catalogue is code, shared by both sides -- and it must surface as a visible
 * parse error rather than as a checkbox that silently never appears.
 */

const permissionKeySchema = z.enum(
  ALL_PERMISSIONS as unknown as [PermissionKey, ...PermissionKey[]],
);

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Seeded roles are protected from renaming and deletion, not from edits. */
  isSystem: z.boolean(),
  permissions: z.array(permissionKeySchema),
  /** Active accounts holding this role. */
  memberCount: z.number().int(),
});

export type Role = z.infer<typeof roleSchema>;

export const rolesResponseSchema = z.object({ data: z.array(roleSchema) });

export type RolesResponse = z.infer<typeof rolesResponseSchema>;

/**
 * The permission catalogue, grouped by the family in its key.
 *
 * Derived from `ALL_PERMISSIONS` rather than hand-listed: a permission added to
 * the contract package appears here without anybody remembering to, which is
 * the difference between a matrix that documents the system and one that
 * documents what somebody typed once.
 */
export interface PermissionGroup {
  readonly family: string;
  readonly label: string;
  readonly permissions: readonly { key: PermissionKey; description: string }[];
}

const FAMILY_LABELS: Record<string, string> = {
  punch: 'Punch',
  attendance: 'Attendance',
  leave: 'Leave',
  regularization: 'Regularization',
  employee: 'Employees',
  shift: 'Shifts and rosters',
  holiday: 'Holidays',
  report: 'Reports',
  settings: 'Settings',
  roles: 'Roles',
  audit: 'Audit',
  integration: 'Integrations',
};

function familyOf(key: PermissionKey): string {
  return key.split('.')[0] ?? key;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = (() => {
  const byFamily = new Map<string, { key: PermissionKey; description: string }[]>();

  for (const key of ALL_PERMISSIONS) {
    const family = familyOf(key);
    const bucket = byFamily.get(family) ?? [];
    bucket.push({ key, description: PERMISSION_DESCRIPTIONS[key] });
    byFamily.set(family, bucket);
  }

  return [...byFamily].map(([family, permissions]) => ({
    family,
    // An unlabelled family is still shown, with its raw key as the heading. A
    // permission that silently disappeared from the matrix because nobody
    // added a label would be worse than an ugly heading.
    label: FAMILY_LABELS[family] ?? family,
    permissions,
  }));
})();

export function countAllPermissions(): number {
  return PERMISSION_GROUPS.reduce((total, group) => total + group.permissions.length, 0);
}

/** Sorted, so two comparisons of the same set cannot differ by arrangement. */
export function samePermissionSet(
  left: readonly PermissionKey[],
  right: readonly PermissionKey[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((key, index) => key === b[index]);
}
