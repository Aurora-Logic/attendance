import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../../jobs/job-handler.js';
import type { JobPayloads } from '../../jobs/queue.registry.js';
import { AuthService } from '../auth.service.js';

/**
 * The consumer for `deliver-password-reset` (REQ-B-04).
 *
 * It exists so that `POST /auth/password-resets` can answer 202 without having
 * looked the account up: everything whose cost depends on whether the address
 * is real happens here, where no caller is timing it.
 *
 * The payload has been through Redis and arrives as JSON, so the one field the
 * handler cannot work without is checked rather than trusted. A payload with no
 * usable address is a permanent failure -- retrying it five times would only
 * put the same broken job in the failed set five attempts later.
 *
 * The result deliberately does *not* say which branch ran. A job's return value
 * is stored on the job and is readable through the admin job monitor, and
 * "no-account" against a visible address would move the enumeration oracle from
 * the response timing into the operations console.
 */
@Injectable()
export class DeliverPasswordResetHandler
  implements JobHandler<'deliver-password-reset'>, OnModuleInit
{
  readonly jobName = 'deliver-password-reset' as const;

  constructor(
    private readonly auth: AuthService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    payload: JobPayloads['deliver-password-reset'],
    _context: JobContext,
  ): Promise<JobResult> {
    const email = payload.email;
    if (typeof email !== 'string' || email.length === 0) {
      throw new Error('Queued password reset carries no address.');
    }

    const ip = typeof payload.ip === 'string' ? payload.ip : null;

    await this.auth.deliverPasswordReset(email, ip);

    return { handled: true };
  }
}
