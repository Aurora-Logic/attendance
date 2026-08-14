import { notificationListQuerySchema, notificationPreferencesInputSchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. Both schemas live in `@vyuha/shared` so the bell
 * and the preferences screen validate what the server validates, and nothing
 * is redefined here.
 */
export class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}
export class NotificationPreferencesDto extends createZodDto(notificationPreferencesInputSchema) {}
