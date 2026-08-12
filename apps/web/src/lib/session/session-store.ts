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
  permissions: ReadonlySet<PermissionKey>;
  /** True when the set came from the dev preview rather than from `/me`. */
  isPreview: boolean;
  setFromMe: (input: {
    displayName: string;
    roleLabel: string;
    permissions: PermissionKey[];
  }) => void;
  applyPreviewRole: (role: SystemRoleName) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  displayName: null,
  roleLabel: null,
  permissions: new Set<PermissionKey>(),
  isPreview: false,

  setFromMe: ({ displayName, roleLabel, permissions }) =>
    set({
      status: 'authenticated',
      displayName,
      roleLabel,
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
      permissions: new Set(ROLE_PERMISSION_MATRIX[role]),
      isPreview: true,
    }),

  clear: () =>
    set({
      status: 'anonymous',
      displayName: null,
      roleLabel: null,
      permissions: new Set<PermissionKey>(),
      isPreview: false,
    }),
}));
