import {
  compOffGrantSchema,
  compOffQuerySchema,
  leaveAdjustmentSchema,
  leaveApplicationSchema,
  leaveBalanceQuerySchema,
  leaveCalendarQuerySchema,
  leaveCancellationSchema,
  leaveDecisionSchema,
  leaveLedgerQuerySchema,
  leavePreviewQuerySchema,
  leaveRejectionSchema,
  leaveRequestQuerySchema,
  leaveTypeInputSchema,
  leaveTypePatchSchema,
  leaveTypeQuerySchema,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. Every schema lives in `@vyuha/shared` so the web
 * client validates the same shapes before it sends them; this file is only the
 * adapter that lets `ZodValidationPipe` find one from a parameter's type.
 */

export class LeaveTypeInputDto extends createZodDto(leaveTypeInputSchema) {}
export class LeaveTypePatchDto extends createZodDto(leaveTypePatchSchema) {}
export class LeaveTypeQueryDto extends createZodDto(leaveTypeQuerySchema) {}

export class LeaveBalanceQueryDto extends createZodDto(leaveBalanceQuerySchema) {}
export class LeaveLedgerQueryDto extends createZodDto(leaveLedgerQuerySchema) {}
export class LeaveAdjustmentDto extends createZodDto(leaveAdjustmentSchema) {}

export class LeavePreviewQueryDto extends createZodDto(leavePreviewQuerySchema) {}
export class LeaveApplicationDto extends createZodDto(leaveApplicationSchema) {}
export class LeaveRequestQueryDto extends createZodDto(leaveRequestQuerySchema) {}
export class LeaveDecisionDto extends createZodDto(leaveDecisionSchema) {}
export class LeaveRejectionDto extends createZodDto(leaveRejectionSchema) {}
export class LeaveCancellationDto extends createZodDto(leaveCancellationSchema) {}

export class CompOffGrantDto extends createZodDto(compOffGrantSchema) {}
export class CompOffQueryDto extends createZodDto(compOffQuerySchema) {}

export class LeaveCalendarQueryDto extends createZodDto(leaveCalendarQuerySchema) {}
