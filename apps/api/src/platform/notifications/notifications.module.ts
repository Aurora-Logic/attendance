import { Global, Module } from '@nestjs/common';

import { EmailChannel } from './channels/email.channel.js';
import { InAppChannel } from './channels/in-app.channel.js';
import { SendNotificationHandler } from './handlers/send-notification.handler.js';
import { ChannelRegistry } from './notification-channel.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationDispatcher } from './notification.dispatcher.js';
import { RecipientResolver } from './recipient-resolver.service.js';

/**
 * Global: every module that will ever exist emits notifications, and only
 * `NotificationDispatcher` is exported. The channels, the resolver, and the
 * preference reader are internal on purpose -- exporting a channel would make
 * it possible for a feature to send on one directly, which technical design
 * §12 rules out.
 *
 * **Adding WhatsApp is one line here plus one file in `channels/`.** No call
 * site changes, no template changes, no dispatcher change: the class registers
 * itself with `ChannelRegistry` on init and joins the fan-out.
 */
@Global()
@Module({
  providers: [
    ChannelRegistry,
    RecipientResolver,
    NotificationPreferencesService,
    NotificationDispatcher,
    InAppChannel,
    EmailChannel,
    SendNotificationHandler,
  ],
  exports: [NotificationDispatcher],
})
export class NotificationsModule {}
