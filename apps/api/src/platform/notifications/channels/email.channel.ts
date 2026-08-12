import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { NotificationChannel as NotificationChannelKey } from '@vyuha/shared';

import { Mailer } from '../../mail/mailer.js';
import {
  ChannelRegistry,
  type NotificationChannel,
  type Recipient,
  type RenderedNotification,
} from '../notification-channel.js';

/**
 * REQ-K-02's email half, on the same `Mailer` port the invitation flow uses --
 * so whichever transport is configured, notifications use it too, and there is
 * one place where mail is sent.
 *
 * The only per-channel decision here is presentation: email needs a subject
 * line and the link has to be spelled out, because there is nothing to click
 * through to in a plain-text message otherwise. The bell renders the same
 * title and body without either.
 */
@Injectable()
export class EmailChannel implements NotificationChannel, OnModuleInit {
  readonly key: NotificationChannelKey = 'email';
  readonly persistsRecord = false;

  constructor(
    private readonly mailer: Mailer,
    private readonly registry: ChannelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async send(to: Recipient, message: RenderedNotification): Promise<void> {
    await this.mailer.send({
      to: to.email,
      subject: message.title,
      body: message.body,
      ...(message.actionUrl === null ? {} : { actionUrl: message.actionUrl }),
    });
  }
}
