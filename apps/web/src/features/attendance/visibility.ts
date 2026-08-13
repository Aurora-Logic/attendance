import { canViewOvertime } from '@vyuha/shared';

import { usePermissions } from '@/lib/session/permissions';

/**
 * Whether this viewer may see overtime on an attendance day.
 *
 * The control is on the server, which omits `otMinutes` from the row entirely
 * for a viewer holding only `attendance.view.self`. This is the other half
 * CLAUDE.md §4 asks for -- "RBAC enforced server-side ... and reflected in the
 * UI" -- so a column is not rendered for a value that will never arrive.
 *
 * The predicate itself lives in `@vyuha/shared` beside the contract, so the
 * screen and the endpoint cannot come to different conclusions about who may
 * see it. Nothing here decides access; it only decides what to draw.
 */
export function useCanViewOvertime(): boolean {
  return canViewOvertime(usePermissions());
}
