import { Injectable, Logger } from '@nestjs/common';

import { env, isProduction } from '../common/env.js';

/**
 * The outbound mail port.
 *
 * REQ-B-03 and REQ-B-04 both deliver a single-use token by email, and REQ-B-10
 * sends a lockout notice. **No SMTP client is implemented in this phase**:
 * `nodemailer` is not an installed dependency and this phase was told not to
 * add one. `LogMailer` below is the only implementation, and it writes the
 * message to the structured log instead of sending it.
 *
 * The port exists anyway, and that is the point. When the SMTP adapter lands
 * it is a second class implementing this interface plus one line in
 * `MailModule`; no caller changes, and the invitation service never learns
 * what a transport is.
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

@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(mail: OutboundMail): Promise<void> {
    if (isProduction) {
      // Loud, and deliberately without the link. In production this is a
      // failure to deliver an invitation, not a debugging convenience, and the
      // token must not be sitting in a log aggregator.
      this.logger.error({
        msg: 'No mail transport is configured; this message was NOT delivered.',
        to: mail.to,
        subject: mail.subject,
      });
      return Promise.resolve();
    }

    this.logger.log({
      msg: 'Outbound mail (development transport: logged, not sent)',
      to: mail.to,
      from: env.MAIL_FROM,
      subject: mail.subject,
      body: mail.body,
      actionUrl: mail.actionUrl,
    });
    return Promise.resolve();
  }
}
