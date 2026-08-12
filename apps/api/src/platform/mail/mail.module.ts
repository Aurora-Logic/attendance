import { Global, Module } from '@nestjs/common';

import { env } from '../common/env.js';
import { LogMailer, Mailer } from './mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/**
 * One binding, chosen by configuration. Everything that sends mail injects
 * `Mailer` and cannot tell which implementation it got.
 *
 * `useClass` rather than a factory so Nest owns the instance and its
 * `onApplicationShutdown` hook runs -- a pooled SMTP transport that is never
 * closed keeps the process alive past SIGTERM.
 */
@Global()
@Module({
  providers: [
    { provide: Mailer, useClass: env.MAIL_TRANSPORT === 'smtp' ? SmtpMailer : LogMailer },
  ],
  exports: [Mailer],
})
export class MailModule {}
