import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { LoginRateLimiter } from '../auth/login-rate-limit.service.js';
import {
  TOKEN_PURPOSES,
  generateOpaqueToken,
  hashOpaqueToken,
  isWellFormedToken,
} from '../auth/opaque-token.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { integrationConnections } from '../db/schema/index.js';
import type { AgentPrincipal } from './agent-principal.js';

/**
 * The agent credential, built on the same opaque-token primitives as refresh,
 * invitation and password-reset tokens (technical design §14.1, 09 §5) — a
 * first version here re-implemented them with a bare SHA-256, which forfeits
 * exactly the two properties `opaque-token.ts` documents: a leaked table of
 * bare hashes can be matched offline against guessed tokens, and a hash
 * without a purpose in its key can be replayed against a different verifier.
 *
 * Not a JWT, deliberately. A JWT is a claim about a person that expires; this
 * is a machine credential that lives until rotated, and keeping the two
 * shapes disjoint is what makes it structurally impossible for an agent
 * token to reach a user route or a user token an agent route — each verifier
 * only understands its own kind.
 */

const TOKEN_PREFIX = 'vyagt_';

function hashed(token: string): string {
  return hashOpaqueToken(TOKEN_PURPOSES.AGENT, token, env.JWT_REFRESH_SECRET);
}

@Injectable()
export class AgentAuthService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly limiter: LoginRateLimiter,
  ) {}

  /** A fresh secret. The caller stores the hash and shows the token once. */
  mint(): { token: string; tokenHash: string } {
    const token = `${TOKEN_PREFIX}${generateOpaqueToken()}`;
    return { token, tokenHash: hashed(token) };
  }

  /**
   * Resolves a presented bearer token to the one connection it belongs to.
   *
   * The lookup is a keyed-HMAC equality against a stored hash, so a match is
   * the whole proof: nothing that reaches the SELECT can collide without the
   * secret, and there is deliberately no post-query comparison — a check
   * that cannot fail teaches the next reader to wonder what it guards.
   *
   * Guesses are throttled per address through the same sliding window that
   * guards sign-in, in its own scope: this is the product's other
   * unauthenticated credential check, and without a limiter it would be the
   * one an attacker could drive freely. Successes clear the address, so an
   * office NAT full of healthy agents never accumulates a budget.
   */
  async resolve(token: string, ip: string | null): Promise<AgentPrincipal> {
    // The claim stands as a recorded failure unless the whole address is
    // cleared on success below — the same accounting sign-in uses.
    await this.limiter.claimAttempt(ip, Date.now(), 'agent');

    if (!token.startsWith(TOKEN_PREFIX) || !isWellFormedToken(token)) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This route takes a connector agent token.');
    }

    const rows = await this.db
      .select({
        id: integrationConnections.id,
        orgId: integrationConnections.orgId,
        companyGuid: integrationConnections.companyGuid,
        leaseHolder: integrationConnections.leaseHolder,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.agentTokenHash, hashed(token)),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      // Indistinguishable from a revoked token on purpose: an attacker
      // probing credentials learns "no", never which part was wrong.
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'This agent credential is not recognised.');
    }

    await this.limiter.clear(ip, 'agent');

    return {
      connectionId: row.id,
      orgId: row.orgId,
      companyGuid: row.companyGuid,
      leaseHolder: row.leaseHolder,
    };
  }
}
