import { Injectable, Logger } from '@nestjs/common';

import { env, isProduction } from '../common/env.js';

/**
 * The outbound mail port.
 *
 * REQ-B-03 and REQ-B-04 both deliver a single-use token by email, and REQ-B-10
 * sends a lockout notice. Two implementations exist and `MAIL_TRANSPORT`
 * chooses between them: `SmtpMailer` sends through nodemailer, and `LogMailer`
 * below writes the message to the structured log instead.
 *
 * No caller knows which one it has. The invitation service never learns what a
 * transport is, which is what made adding SMTP a new class and one line in
 * `MailModule` rather than an edit to every send site.
 */
export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /**
   * A link the recipient must follow. Kept separate from `body` so the
   * development mailer can surface it prominently and a future HTML template
   * can render it as a button rather than as text.
   */
  readonly actionUrl?: string;
}

/**
 * Abstract class rather than an interface plus a string token: Nest can use
 * the class itself as the injection token, so a call site asks for `Mailer`
 * and cannot mistype a token string.
 */
export abstract class Mailer {
  abstract send(mail: OutboundMail): Promise<void>;
}

/**
 * Delivery by log line. Selected with `MAIL_TRANSPORT=log`, and the right
 * choice for a developer with no SMTP server and for any test that wants the
 * invitation token without a mailbox.
 */
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(mail: OutboundMail): Promise<void> {
    if (isProduction) {
      // Loud, and deliberately without the link. In production this is a
      // failure to deliver an invitation, not a debugging convenience, and the
      // token must not be sitting in a log aggregator.
      this.logger.error({
        msg: 'MAIL_TRANSPORT is "log" in production; this message was NOT delivered.',
        to: mail.to,
        subject: mail.subject,
      });
      return Promise.resolve();
    }

    this.logger.log({
      msg: 'Outbound mail (log transport: logged, not sent)',
      to: mail.to,
      from: env.MAIL_FROM,
      subject: mail.subject,
      body: mail.body,
      actionUrl: mail.actionUrl,
    });
    return Promise.resolve();
  }
}
