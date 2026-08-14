import { consentAcceptanceInputSchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * The Nest-facing wrapper. The schema lives in `@vyuha/shared` so the web
 * client validates the same shape before it sends it.
 */
export class ConsentAcceptanceDto extends createZodDto(consentAcceptanceInputSchema) {}
