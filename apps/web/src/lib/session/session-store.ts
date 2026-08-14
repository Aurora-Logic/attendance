import { create } from 'zustand';

import { ROLE_PERMISSION_MATRIX, type PermissionKey, type SystemRoleName } from '@vyuha/shared';

/**
 * The effective permission set for the signed-in user, as returned by `/me`
 * (technical design §10).
 *
 * Client gating is cosmetic. Every endpoint enforces independently — this
 * store decides what to render, never what is allowed.
 */
interface SessionState {
  status: 'loading' | 'authenticated' | 'anonymous';
  displayName: string | null;
  roleLabel: string | null;
  /**
   * The signed-in account's own employee record, or null for an account with
   * none (REQ-B-02). Screens use it to say "this row is yours" — the server
   * re-checks every such rule regardless (REQ-I-05).
   */
  employeeId: string | null;
  permissions: ReadonlySet<PermissionKey>;
  /** True when the set came from the dev preview rather than from `/me`. */
  isPreview: boolean;
  setFromMe: (input: {
    displayName: string;
    roleLabel: string;
    employeeId: string | null;
    permissions: PermissionKey[];
  }) => void;
  applyPreviewRole: (role: SystemRoleName) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  displayName: null,
  roleLabel: null,
  employeeId: null,
  permissions: new Set<PermissionKey>(),
  isPreview: false,

  setFromMe: ({ displayName, roleLabel, employeeId, permissions }) =>
    set({
      status: 'authenticated',
      displayName,
      roleLabel,
      employeeId,
      permissions: new Set(permissions),
      isPreview: false,
    }),

  /**
   * Development only. The API does not exist yet, so without this the sidebar
   * renders empty and none of the permission filtering can be seen working.
   * Guarded by the caller on `import.meta.env.DEV` and surfaced with a visible
   * banner, so it can never be mistaken for a real session.
   */
  applyPreviewRole: (role) =>
    set({
      status: 'authenticated',
      displayName: 'Preview user',
      roleLabel: role,
      employeeId: null,
      permissions: new Set(ROLE_PERMISSION_MATRIX[role]),
      isPreview: true,
    }),

  clear: () =>
    set({
      status: 'anonymous',
      displayName: null,
      roleLabel: null,
      employeeId: null,
      permissions: new Set<PermissionKey>(),
      isPreview: false,
    }),
}));
