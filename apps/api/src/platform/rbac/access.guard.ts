import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@vyuha/shared';
import type { Request } from 'express';

import { AuditContext } from '../audit/audit-context.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { AgentAuthService } from '../sync/agent-auth.service.js';
import { hasAnyPermission, type Principal } from './principal.js';
import { PrincipalService } from './principal.service.js';
import { ROUTE_POLICY_DECORATORS, ROUTE_POLICY_KEY, type RoutePolicy } from './route-policy.js';

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
    private readonly agents: AgentAuthService,
    private readonly auditContext: AuditContext,
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
          `Annotate it with ${ROUTE_POLICY_DECORATORS}.`,
      );
    }

    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<Request>();

    // The two credential worlds never meet (09 §5): an agent route resolves
    // only an agent token and sets only `request.agent`, so nothing
    // downstream can mistake a machine for a person — and a user JWT fails
    // here because it is not an agent credential, not because of anything a
    // handler remembered to check.
    if (policy.kind === 'agent') {
      request.agent = await this.agents.resolve(bearerOf(request), request.ip ?? null);
      // The audit interceptor reads request.principal, which agent routes
      // never set; attributing the organisation here is what lets an agent
      // mutation write an audit row at all instead of warning "no
      // organisation". Whether a given endpoint then records or suppresses
      // is that endpoint's decision, exactly as it is for user routes.
      this.auditContext.attribute(request.agent.orgId, null);
      return true;
    }

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
    const claims = await verifyAccessToken(bearerOf(request), env.JWT_ACCESS_SECRET);

    return this.principals.resolve({
      userId: claims.sub,
      orgId: claims.org,
      sessionId: claims.sid,
      issuedAtSeconds: claims.iat,
    });
  }
}

function bearerOf(request: Request): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'A bearer access token is required.');
  }
  return header.slice('Bearer '.length).trim();
}
