import { Global, Module } from '@nestjs/common';

import { LogMailer, Mailer } from './mailer.js';

/**
 * One line changes when the SMTP adapter arrives. Everything that sends mail
 * injects `Mailer` and is unaffected.
 */
@Global()
@Module({
  providers: [{ provide: Mailer, useClass: LogMailer }],
  exports: [Mailer],
})
export class MailModule {}
