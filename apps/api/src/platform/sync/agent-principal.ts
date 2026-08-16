import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

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
