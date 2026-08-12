import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../rbac/route-policy.js';
import { HealthService, type LivenessResult, type ReadinessResult } from './health.service.js';

/**
 * Both probes are `@Public()`. An orchestrator has no credentials, and a
 * readiness check that needs a token cannot tell "the database is down" from
 * "the token expired" -- which is the one thing it must never confuse.
 *
 * Neither response reveals anything an unauthenticated caller should not see:
 * dependency error text is withheld in production (see `HealthService`).
 */
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness. Touches nothing, so it answers even while dependencies are out. */
  @Get('health')
  @Public()
  @HttpCode(HttpStatus.OK)
  liveness(): LivenessResult {
    return this.health.liveness();
  }

  /**
   * Readiness. 503 with the per-dependency detail when anything is down, so an
   * orchestrator pulls the instance out of rotation and a human can see which
   * dependency caused it from the same response.
   *
   * `passthrough: true` keeps Nest's serialisation and the global exception
   * filter in play; only the status code is set by hand.
   */
  @Get('ready')
  @Public()
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResult> {
    const result = await this.health.readiness();
    res.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
