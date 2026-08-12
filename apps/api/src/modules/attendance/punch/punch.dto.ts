import {
  attendanceDayQuerySchema,
  idempotencyKeySchema,
  punchFeedQuerySchema,
  punchPhotoQuerySchema,
  punchSubmissionSchema,
  punchSyncSchema,
} from '@vyuha/shared';
import { z } from 'zod';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. The schemas live in `@vyuha/shared` so the PWA
 * validates the same shapes before it queues a punch; this file is only the
 * adapter that lets `ZodValidationPipe` find them from a parameter's type.
 *
 * The two multipart bodies need one extra step. A `multipart/form-data` field
 * is a string however it was written, so the JSON half of a punch arrives as
 * text and has to be parsed before it can be validated. Doing that here, in a
 * schema, rather than in the controller keeps the guarantee the Definition of
 * Done asks for -- "Zod schema validates every request body" -- true for the
 * one endpoint where the body is not JSON.
 */

/** The largest a punch payload can honestly be; the photo is a separate part. */
const MAX_PAYLOAD_CHARS = 4_096;
/** Twenty-five queued punches of payload, plus room for their keys. */
const MAX_SYNC_PAYLOAD_CHARS = 64_000;

function jsonText<TSchema extends z.ZodType>(schema: TSchema, maxChars: number) {
  return z
    .string()
    .min(1)
    .max(maxChars)
    .transform((raw, ctx): unknown => {
      try {
        return JSON.parse(raw);
      } catch {
        // Reported as a field error rather than rethrown: a malformed payload
        // is a client mistake, and a raw SyntaxError would surface as a 500.
        ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

export const punchFormSchema = z.object({
  payload: jsonText(punchSubmissionSchema, MAX_PAYLOAD_CHARS),
});

export const punchSyncFormSchema = z.object({
  payload: jsonText(punchSyncSchema, MAX_SYNC_PAYLOAD_CHARS),
});

/**
 * REQ-D-11. The header, validated with the same rules the sync body applies to
 * its per-entry keys, so a key cannot be acceptable through one door and not
 * the other.
 */
export const idempotencyHeaderSchema = idempotencyKeySchema;

export class PunchFormDto extends createZodDto(punchFormSchema) {}
export class PunchSyncFormDto extends createZodDto(punchSyncFormSchema) {}
export class PunchFeedQueryDto extends createZodDto(punchFeedQuerySchema) {}
export class PunchPhotoQueryDto extends createZodDto(punchPhotoQuerySchema) {}
export class AttendanceDayQueryDto extends createZodDto(attendanceDayQuerySchema) {}
