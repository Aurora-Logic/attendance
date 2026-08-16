import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../common/errors.js';

/**
 * Who is calling an `@AgentRoute()` — a connector agent, resolved from its
 * per-connection credential by `AccessGuard`.
 *
 * Deliberately not a `Principal` and never stored in `request.principal`: an
 * agent has no user, no roles, no permission set, and no session, and giving
 * it a Principal-shaped identity would let it drift into code paths that
 * reason about people. It is one connection's sync channel, and this type can
 * express nothing more (09 §5).
 */
export interface AgentPrincipal {
  readonly connectionId: string;
  readonly orgId: string;
  /** What the server expects the agent to have open; null until bound. */
  readonly companyGuid: string | null;
  /**
   * A snapshot from credential resolution, good enough for a friendly 409.
   * Every decision that must be exact — the lease handover, the claim —
   * re-states its rule inside its own UPDATE's predicate instead of trusting
   * this value, which can be stale by the time the statement runs.
   */
  readonly leaseHolder: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `AccessGuard` on `@AgentRoute()` routes only. */
      agent?: AgentPrincipal;
    }
  }
}

/** `@CurrentAgent()` on an agent route's handler parameter. */
export const CurrentAgent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AgentPrincipal => {
    const request = context.switchToHttp().getRequest<Request>();
    const agent = request.agent;
    if (agent === undefined) {
      throw new Error(
        'CurrentAgent was requested on a route AccessGuard did not resolve an agent for. ' +
          'The handler is probably missing @AgentRoute().',
      );
    }
    return agent;
  },
);

/**
 * 09 §7's one company rule, stated once for both call sites: the claim and
 * the results post each require the caller's Tally to have the bound company
 * open. Two hand-kept copies of a security predicate is how one path gets a
 * rule change and the other keeps the hole.
 */
export function requireAgentCompany(
  agent: AgentPrincipal,
  openCompanyGuid: string | undefined,
): void {
  if (agent.companyGuid === null) {
    throw AppError.conflict(
      'This connection is not yet bound to a Tally company. An administrator sets the ' +
        'company GUID on the connection first; until then no work runs.',
    );
  }
  if (openCompanyGuid !== agent.companyGuid) {
    throw AppError.conflict(
      `Tally has ${openCompanyGuid === undefined ? 'no company' : 'a different company'} open, ` +
        'and work against the wrong books is worse than work that waits. ' +
        'Open the bound company and try again.',
      { expectedCompanyGuid: agent.companyGuid },
    );
  }
}
