import { reasonBodySchema, recycleBinQuerySchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * Nest-facing wrappers. The schemas live in `@vyuha/shared` so the confirm
 * dialogs on the web side hold their submit button to the same minimum reason
 * length the server enforces — a refusal the user could have been shown before
 * they typed is a refusal that should never reach the network.
 */

export class RecycleBinQueryDto extends createZodDto(recycleBinQuerySchema) {}
export class ReasonBodyDto extends createZodDto(reasonBodySchema) {}
