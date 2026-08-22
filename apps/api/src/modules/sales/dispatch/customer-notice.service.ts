import { Injectable } from '@nestjs/common';
import type { DispatchView, SalesDocumentView } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { describeError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { DocumentSettingsService } from '../../../platform/documents/document-settings.service.js';
import { Mailer } from '../../../platform/mail/mailer.js';
import { renderDispatchNotice, renderInvoiceNotice } from './customer-notice.js';

/**
 * D-47: the customer's email for a dispatch moment, sent from the
 * organisation's mailbox the instant the moment happens, and recorded on
 * the notification row the dispatch already composed. WhatsApp stays
 * click-to-send; only email goes by itself.
 *
 * Never throws: a mail server's bad afternoon is recorded on the row as
 * `failed` with the reason, where the team can resend, and the dispatch
 * itself stands.
 */
@Injectable()
export class CustomerNoticeService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly settings: DocumentSettingsService,
  ) {}

  async send(orgId: string, dispatch: DispatchView, event: 'dispatched' | 'delivered', contactName: string | null): Promise<void> {
    const row = dispatch.notifications.find((n) => n.channel === 'email' && (n.event ?? 'dispatched') === event);
    if (row === undefined || row.recipient === null || row.status !== 'pending') return;
    try {
      const [settings, org] = await Promise.all([
        this.settings.read(orgId),
        this.db.execute<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${orgId}`),
      ]);
      const notice = renderDispatchNotice({ event, orgName: org.rows[0]?.name ?? '', profile: settings.profile, dispatch, contactName });
      await this.mailer.send({
        to: row.recipient,
        subject: notice.subject,
        body: notice.text,
        html: notice.html,
        ...(settings.profile.email.trim() === '' ? {} : { replyTo: settings.profile.email }),
      });
      await this.db.execute(sql`UPDATE dispatch_notifications SET status = 'sent', sent_at = now(), error = NULL, updated_at = now() WHERE id = ${row.id}`);
    } catch (error: unknown) {
      await this.db.execute(sql`UPDATE dispatch_notifications SET status = 'failed', error = ${describeError(error).slice(0, 500)}, updated_at = now() WHERE id = ${row.id}`);
    }
  }

  /**
   * E4: the invoice mail, on confirmation. The address is the invoice's own,
   * else the order's, else the party's. Returns what happened so the caller
   * can audit it; there is no notification table for invoices yet.
   */
  async sendInvoice(orgId: string, invoice: SalesDocumentView): Promise<{ to: string | null; outcome: 'sent' | 'failed' | 'no-address'; error?: string }> {
    const source = await this.db.execute<{ number: string; customer_email: string | null; party_email: string | null }>(sql`
      SELECT d.number, d.customer_email, p.email AS party_email
        FROM sales_documents d LEFT JOIN parties p ON p.id = d.party_id
       WHERE d.org_id = ${orgId} AND d.id = ${invoice.sourceDocumentId ?? invoice.id}
    `);
    const order = source.rows[0];
    const to = invoice.customerEmail ?? order?.customer_email ?? order?.party_email ?? null;
    if (to === null) return { to: null, outcome: 'no-address' };
    try {
      const [settings, org] = await Promise.all([
        this.settings.read(orgId),
        this.db.execute<{ name: string }>(sql`SELECT name FROM organizations WHERE id = ${orgId}`),
      ]);
      const notice = renderInvoiceNotice({ orgName: org.rows[0]?.name ?? '', profile: settings.profile, invoice, orderNumber: invoice.sourceDocumentId === null ? null : (order?.number ?? null), contactName: null });
      await this.mailer.send({
        to,
        subject: notice.subject,
        body: notice.text,
        html: notice.html,
        ...(settings.profile.email.trim() === '' ? {} : { replyTo: settings.profile.email }),
      });
      return { to, outcome: 'sent' };
    } catch (error: unknown) {
      return { to, outcome: 'failed', error: describeError(error).slice(0, 500) };
    }
  }
}
