import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, uuidv7, type PermissionKey } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { AppError } from '../common/errors.js';
import { signAccessToken } from '../auth/jwt.js';
import { env } from '../common/env.js';
import type { AuditContext } from '../audit/audit-context.js';
import type { AgentAuthService } from '../sync/agent-auth.service.js';
import { AccessGuard } from './access.guard.js';
import type { Principal } from './principal.js';
import type { PrincipalService } from './principal.service.js';
import { Authenticated, Public, RequirePermission } from './route-policy.js';

/**
 * Deny by default, proven against the real decorators and the real
 * `Reflector`.
 *
 * What is faked here is only the `ExecutionContext` and the database read.
 * What is real is the metadata -- these are the same decorators the
 * controllers use -- and the guard itself. A test that set the metadata by
 * hand would prove the guard reads a key, not that `@Public()` writes it.
 *
 * The complementary check runs at boot: `RoutePolicyAudit` refuses to start
 * the application if any route reaches production without a policy, and an
 * end-to-end 403 for an under-privileged token is asserted in
 * `auth.endpoints.test.ts`.
 */

@Controller('probe')
class ProbeController {
  /** Deliberately unannotated. This is the case the guard exists for. */
  @Get('forgotten')
  forgotten(): string {
    return 'should never be reachable';
  }

  @Get('open')
  @Public()
  open(): string {
    return 'ok';
  }

  @Get('signed-in')
  @Authenticated()
  signedIn(): string {
    return 'ok';
  }

  @Get('privileged')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  privileged(): string {
    return 'ok';
  }

  @Get('either')
  @RequirePermission(PERMISSIONS.ATTENDANCE_VIEW_TEAM, PERMISSIONS.ATTENDANCE_VIEW_ALL)
  either(): string {
    return 'ok';
  }
}

@Controller('inherited')
@RequirePermission(PERMISSIONS.AUDIT_VIEW)
class InheritedPolicyController {
  @Get('one')
  one(): string {
    return 'ok';
  }

  @Get('two')
  @Public()
  two(): string {
    return 'ok';
  }
}

interface Handlers {
  readonly [key: string]: (...args: never[]) => unknown;
}

const userId = uuidv7();
const orgId = uuidv7();
const sessionId = uuidv7();

function principalWith(keys: readonly PermissionKey[]): Principal {
  return {
    userId,
    orgId,
    employeeId: null,
    email: 'probe@vyuha.test',
    status: 'ACTIVE',
    sessionId,
    roles: [],
    permissions: new Set(keys),
  };
}

function contextFor(
  controller: new () => object,
  method: string,
  headers: Record<string, string> = {},
): { context: ExecutionContext; request: { headers: Record<string, string>; principal?: Principal } } {
  const request: { headers: Record<string, string>; principal?: Principal } = { headers };
  const prototype = controller.prototype as Handlers;
  const handler = prototype[method];
  if (typeof handler !== 'function') throw new Error(`No handler ${method}`);

  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function guardFor(principal: Principal | Error): AccessGuard {
  const principals = {
    resolve: () => (principal instanceof Error ? Promise.reject(principal) : Promise.resolve(principal)),
  } as unknown as PrincipalService;
  // Refuses everything: these cases exercise the user-credential paths, and
  // an agent resolution reaching this stub would itself be the bug.
  const agents = {
    resolve: () => Promise.reject(new Error('no agent credential in this test')),
  } as unknown as AgentAuthService;
  // Inert: nothing in these cases reaches an agent route, so nothing is
  // attributed or suppressed.
  const audit = { attribute: () => undefined } as unknown as AuditContext;
  return new AccessGuard(new Reflector(), principals, agents, audit);
}

async function bearer(): Promise<Record<string, string>> {
  const token = await signAccessToken({
    userId,
    orgId,
    sessionId,
    ttlSeconds: 300,
    secret: env.JWT_ACCESS_SECRET,
  });
  return { authorization: `Bearer ${token}` };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('Expected the guard to refuse.');
}

describe('AccessGuard denies by default', () => {
  it('refuses a route with no policy, even with a perfectly valid token', async () => {
    const guard = guardFor(principalWith([PERMISSIONS.EMPLOYEE_MANAGE, PERMISSIONS.ROLES_MANAGE]));
    const { context } = contextFor(ProbeController, 'forgotten', await bearer());

    // The caller here holds every permission that exists in the file and is
    // fully authenticated. The refusal is because the endpoint said nothing.
    expect(await codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
  });

  it('refuses an unannotated route to an anonymous caller too', async () => {
    const guard = guardFor(principalWith([]));
    const { context } = contextFor(ProbeController, 'forgotten');
    expect(await codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
  });

  it('refuses a non-http transport rather than letting it through', async () => {
    const guard = guardFor(principalWith([]));
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;
    expect(await codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
  });
});

describe('AccessGuard policies', () => {
  it('lets a public route through with no credentials and attaches no principal', async () => {
    const guard = guardFor(principalWith([]));
    const { context, request } = contextFor(ProbeController, 'open');
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.principal).toBeUndefined();
  });

  it('requires a bearer token on an authenticated route', async () => {
    const guard = guardFor(principalWith([]));
    const { context } = contextFor(ProbeController, 'signedIn');
    expect(await codeOf(() => guard.canActivate(context))).toBe('TOKEN_INVALID');

    const withToken = contextFor(ProbeController, 'signedIn', await bearer());
    expect(await guard.canActivate(withToken.context)).toBe(true);
    expect(withToken.request.principal?.userId).toBe(userId);
  });

  it('rejects a token that is present but not a bearer token', async () => {
    const guard = guardFor(principalWith([]));
    for (const header of ['', 'Basic abc', 'bearer lowercase-scheme', 'Bearer']) {
      const { context } = contextFor(ProbeController, 'signedIn', { authorization: header });
      expect(await codeOf(() => guard.canActivate(context))).toBe('TOKEN_INVALID');
    }
  });

  it('grants a permission route only to a holder, and names the requirement', async () => {
    const withoutIt = guardFor(principalWith([PERMISSIONS.PUNCH_SELF]));
    const { context } = contextFor(ProbeController, 'privileged', await bearer());

    try {
      await withoutIt.canActivate(context);
      throw new Error('Expected FORBIDDEN.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) {
        expect(error.code).toBe('FORBIDDEN');
        expect(error.details).toEqual({ requiredAnyOf: [PERMISSIONS.EMPLOYEE_MANAGE] });
      }
    }

    const withIt = guardFor(principalWith([PERMISSIONS.EMPLOYEE_MANAGE]));
    const allowed = contextFor(ProbeController, 'privileged', await bearer());
    expect(await withIt.canActivate(allowed.context)).toBe(true);
  });

  it('treats several keys as "any of", not "all of"', async () => {
    const teamOnly = guardFor(principalWith([PERMISSIONS.ATTENDANCE_VIEW_TEAM]));
    const allOnly = guardFor(principalWith([PERMISSIONS.ATTENDANCE_VIEW_ALL]));
    const neither = guardFor(principalWith([PERMISSIONS.ATTENDANCE_VIEW_SELF]));

    expect(await teamOnly.canActivate(contextFor(ProbeController, 'either', await bearer()).context)).toBe(
      true,
    );
    expect(await allOnly.canActivate(contextFor(ProbeController, 'either', await bearer()).context)).toBe(
      true,
    );
    const neitherContext = contextFor(ProbeController, 'either', await bearer()).context;
    expect(await codeOf(() => neither.canActivate(neitherContext))).toBe('FORBIDDEN');
  });

  it('inherits a controller-level policy and lets a method override it', async () => {
    const guard = guardFor(principalWith([PERMISSIONS.PUNCH_SELF]));

    const inheritedContext = contextFor(InheritedPolicyController, 'one', await bearer()).context;
    expect(await codeOf(() => guard.canActivate(inheritedContext))).toBe('FORBIDDEN');

    expect(
      await guard.canActivate(contextFor(InheritedPolicyController, 'two').context),
    ).toBe(true);
  });

  it('propagates the reason a principal could not be resolved', async () => {
    const guard = guardFor(new AppError('ACCOUNT_INACTIVE', 'This account is suspended.'));
    const { context } = contextFor(ProbeController, 'signedIn', await bearer());
    expect(await codeOf(() => guard.canActivate(context))).toBe('ACCOUNT_INACTIVE');
  });
});
