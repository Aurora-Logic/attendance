import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PermissionKey } from '@vyuha/shared';

/**
 * Technical design §10: "a `@RequirePermission('attendance.view.all')`
 * decorator plus a guard. Nothing checks a role name."
 *
 * The type of the metadata is the enforcement point for that last sentence:
 * a policy can only ever name `PermissionKey` values from `@vyuha/shared`, so
 * there is no shape a role name could be written in.
 *
 * Every route declares exactly one policy. The guard denies anything with
 * none -- see `AccessGuard` for why the default is deny and
 * `RoutePolicyAudit` for the boot-time check that stops an unannotated route
 * from reaching production in the first place.
 */

export const ROUTE_POLICY_KEY = 'vyuha:route-policy';

/**
 * Every decorator, for error messages that enumerate the choices. One list
 * beside the union it describes, because the guard and the boot audit each
 * print it — two hand-maintained copies drifted the moment `@AgentRoute()`
 * was added, and a message listing three decorators steers the author of an
 * agent route to `@Authenticated()`, the exact credential-world crossing the
 * fourth kind exists to prevent.
 */
export const ROUTE_POLICY_DECORATORS =
  '@Public(), @Authenticated(), @RequirePermission(...), or @AgentRoute()';

export type RoutePolicy =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'permission'; readonly keys: readonly PermissionKey[] }
  | { readonly kind: 'agent' };

/**
 * No credentials required and none read. Reserved for the health probes and
 * the auth endpoints that exist precisely to obtain credentials.
 *
 * ADR 0002: "No public signup endpoint exists ... Absence of a route is the
 * access control." Adding `@Public()` to something that creates an account
 * would undo that, so a new use of this decorator is a review point.
 */
export const Public = (): CustomDecorator<string> =>
  SetMetadata<string, RoutePolicy>(ROUTE_POLICY_KEY, { kind: 'public' });

/**
 * A valid access token is required, but no particular permission. For routes
 * that only ever act on the caller's own identity -- `/auth/me`, `/auth/logout`.
 */
export const Authenticated = (): CustomDecorator<string> =>
  SetMetadata<string, RoutePolicy>(ROUTE_POLICY_KEY, { kind: 'authenticated' });

/**
 * A connector-agent credential is required — and nothing else is accepted.
 *
 * The two credential worlds are deliberately disjoint (09 §5): an agent
 * holds `sync.agent` in spirit and nothing in fact — no user, no roles, no
 * permission set — so a route marked this way can never be reached with a
 * user JWT, and an agent token can never satisfy `@Authenticated()` or
 * `@RequirePermission(...)`, whose paths verify a JWT. A leaked agent
 * credential is scoped to one connection's sync traffic, not to a person.
 */
export const AgentRoute = (): CustomDecorator<string> =>
  SetMetadata<string, RoutePolicy>(ROUTE_POLICY_KEY, { kind: 'agent' });

/**
 * Holding **any** of the listed keys grants access. The multi-key form exists
 * for a permission that comes in breadths -- `@RequirePermission(
 * ATTENDANCE_VIEW_TEAM, ATTENDANCE_VIEW_ALL)` -- where the guard's job is only
 * to keep out someone with neither, and `ScopeService` decides how much of the
 * data the holder actually sees.
 *
 * The tuple type makes `@RequirePermission()` with no arguments a compile
 * error; an empty list would otherwise read as "authenticated" while looking
 * like a permission check.
 */
export const RequirePermission = (
  ...keys: readonly [PermissionKey, ...PermissionKey[]]
): CustomDecorator<string> =>
  SetMetadata<string, RoutePolicy>(ROUTE_POLICY_KEY, { kind: 'permission', keys });
