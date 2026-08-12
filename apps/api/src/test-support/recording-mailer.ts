import { Injectable } from '@nestjs/common';

import { Mailer, type OutboundMail } from '../platform/mail/mailer.js';

/**
 * Captures outbound mail instead of logging it.
 *
 * This is the one provider the test harness replaces, and the substitution is
 * narrow on purpose. The invitation and password-reset flows deliver a
 * single-use token by email and nowhere else -- deliberately, since REQ-B-03
 * stores only the hash -- so a test that wants to *use* the token has to read
 * the message. The alternative, returning the token in the API response under
 * a test flag, would put a real token on a real code path to make testing
 * convenient, which is the sort of shortcut that ends up shipping.
 *
 * The production implementation is `LogMailer`, which also does not send: no
 * SMTP client is an installed dependency yet. So this replaces a no-op with a
 * recording no-op, and nothing under test behaves differently because of it.
 */
@Injectable()
export class RecordingMailer extends Mailer {
  readonly sent: OutboundMail[] = [];

  send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }

  /** The most recent message to an address, or null. */
  lastTo(email: string): OutboundMail | null {
    const address = email.toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const mail = this.sent[i];
      if (mail !== undefined && mail.to.toLowerCase() === address) return mail;
    }
    return null;
  }

  /** The final path segment of the action link, which is the single-use token. */
  tokenFor(email: string): string | null {
    const url = this.lastTo(email)?.actionUrl;
    if (url === undefined) return null;
    const segment = url.split('/').pop();
    return segment !== undefined && segment.length > 0 ? segment : null;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
