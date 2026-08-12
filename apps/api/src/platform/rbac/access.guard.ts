import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@vyuha/shared';
import type { Request } from 'express';

import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { hasAnyPermission, type Principal } from './principal.js';
import { PrincipalService } from './principal.service.js';
import { ROUTE_POLICY_KEY, type RoutePolicy } from './route-policy.js';

/**
 * The single gate. Authentication and authorisation are one guard rather than
 * two because the ordering between them is the part that gets broken: two
 * global guards are executed in registration order, and a provider list is a
 * fragile place to keep a security invariant.
 *
 * **Deny by default.** A route with no policy metadata is refused. That is the
 * inversion of Nest's own default and the whole reason this class exists --
 * forgetting a decorator has to fail closed, because the failure mode of
 * failing open is an endpoint that quietly serves anyone who finds it.
 * `RoutePolicyAudit` turns the same mistake into a boot failure so it is found
 * before a request ever reaches here.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only HTTP exists today. A future queue consumer or websocket gateway
    // must declare its own policy rather than inherit an HTTP one by accident.
    if (context.getType() !== 'http') {
      throw AppError.forbidden('This transport has no access policy.');
    }

    const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(ROUTE_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (policy === undefined) {
      throw AppError.forbidden(
        'This endpoint declares no access policy and is therefore denied. ' +
          'Annotate it with @Public(), @Authenticated(), or @RequirePermission(...).',
      );
    }

    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const principal = await this.authenticate(request);
    request.principal = principal;

    if (policy.kind === 'authenticated') return true;

    if (!hasAnyPermission(principal, policy.keys)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'You do not have permission to do that.', {
        // The client uses this to explain the refusal and to decide which
        // control it should have hidden. It names the requirement, never the
        // permissions the caller happens to hold.
        details: { requiredAnyOf: [...policy.keys] },
      });
    }

    return true;
  }

  private async authenticate(request: Request): Promise<Principal> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'A bearer access token is required.');
    }

    const claims = verifyAccessToken(header.slice('Bearer '.length).trim(), env.JWT_ACCESS_SECRET);

    return this.principals.resolve({
      userId: claims.sub,
      orgId: claims.org,
      sessionId: claims.sid,
      issuedAtSeconds: claims.iat,
    });
  }
}
