import {
  onDutyInputSchema,
  onDutyQuerySchema,
  regularizationCompleteSchema,
  regularizationDecisionSchema,
  regularizationInputSchema,
  regularizationQuerySchema,
  regularizationRejectionSchema,
} from '@vyuha/shared';
import { z } from 'zod';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. Every schema lives in `@vyuha/shared` so the web
 * client validates the same shapes before it sends them; this file is only the
 * adapter that lets `ZodValidationPipe` find one from a parameter's type.
 */

export class RegularizationInputDto extends createZodDto(regularizationInputSchema) {}
export class RegularizationCompleteDto extends createZodDto(regularizationCompleteSchema) {}
export class RegularizationQueryDto extends createZodDto(regularizationQuerySchema) {}
export class RegularizationDecisionDto extends createZodDto(regularizationDecisionSchema) {}
export class RegularizationRejectionDto extends createZodDto(regularizationRejectionSchema) {}

export class OnDutyInputDto extends createZodDto(onDutyInputSchema) {}
export class OnDutyQueryDto extends createZodDto(onDutyQuerySchema) {}

/** `GET /regularizations/policy?employeeId=` — the limits, for the form. */
export const regularizationPolicyQuerySchema = z
  .object({ employeeId: z.uuid().optional() })
  .strict();

export class RegularizationPolicyQueryDto extends createZodDto(regularizationPolicyQuerySchema) {}
