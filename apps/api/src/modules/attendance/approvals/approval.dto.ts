import {
  approvalInboxQuerySchema,
  approveRequestSchema,
  bulkApprovalDecisionSchema,
  createDelegationSchema,
  rejectRequestSchema,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. Every schema lives in `@vyuha/shared` so the web
 * client validates the same shapes before it sends them; this file is only the
 * adapter that lets `ZodValidationPipe` find a schema from a parameter's type.
 *
 * Nothing is redefined here. A schema written twice is a schema that drifts,
 * and the drift shows up as a field one end sends and the other discards.
 */
export class ApprovalInboxQueryDto extends createZodDto(approvalInboxQuerySchema) {}
export class ApproveRequestDto extends createZodDto(approveRequestSchema) {}
export class RejectRequestDto extends createZodDto(rejectRequestSchema) {}
export class BulkApprovalDecisionDto extends createZodDto(bulkApprovalDecisionSchema) {}
export class CreateDelegationDto extends createZodDto(createDelegationSchema) {}
