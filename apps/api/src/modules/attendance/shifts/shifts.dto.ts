import {
  bulkRosterAssignmentSchema,
  createRosterAssignmentSchema,
  createShiftSchema,
  createWeeklyOffPatternSchema,
  rosterListQuerySchema,
  shiftListQuerySchema,
  updateRosterAssignmentSchema,
  updateShiftSchema,
  updateWeeklyOffPatternSchema,
  weeklyOffPatternListQuerySchema,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers for this slice.
 *
 * The schemas live in `@vyuha/shared` so the roster screen's forms validate
 * against the rules the server enforces; this file only makes them findable by
 * `ZodValidationPipe` from a parameter's declared type.
 */

export class ShiftListQueryDto extends createZodDto(shiftListQuerySchema) {}
export class CreateShiftDto extends createZodDto(createShiftSchema) {}
export class UpdateShiftDto extends createZodDto(updateShiftSchema) {}

export class WeeklyOffPatternListQueryDto extends createZodDto(weeklyOffPatternListQuerySchema) {}
export class CreateWeeklyOffPatternDto extends createZodDto(createWeeklyOffPatternSchema) {}
export class UpdateWeeklyOffPatternDto extends createZodDto(updateWeeklyOffPatternSchema) {}

export class RosterListQueryDto extends createZodDto(rosterListQuerySchema) {}
export class CreateRosterAssignmentDto extends createZodDto(createRosterAssignmentSchema) {}
export class UpdateRosterAssignmentDto extends createZodDto(updateRosterAssignmentSchema) {}
export class BulkRosterAssignmentDto extends createZodDto(bulkRosterAssignmentSchema) {}
