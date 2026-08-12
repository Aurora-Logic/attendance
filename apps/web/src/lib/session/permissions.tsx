import type { ReactNode } from 'react';

import type { PermissionKey } from '@vyuha/shared';

import { useSessionStore } from './session-store';

/** Technical design §10: the web client uses this to hide or disable controls. */
export function usePermission(permission: PermissionKey | undefined): boolean {
  return useSessionStore((s) => (permission ? s.permissions.has(permission) : true));
}

export function usePermissions(): ReadonlySet<PermissionKey> {
  return useSessionStore((s) => s.permissions);
}

interface CanProps {
  permission: PermissionKey;
  children: ReactNode;
  /**
   * Rendered instead of hiding. CLAUDE.md §4 asks for the reason to be shown
   * when a control is disabled rather than removed.
   */
  fallback?: ReactNode;
}

export function Can({ permission, children, fallback = null }: CanProps) {
  const allowed = usePermission(permission);
  return <>{allowed ? children : fallback}</>;
}
