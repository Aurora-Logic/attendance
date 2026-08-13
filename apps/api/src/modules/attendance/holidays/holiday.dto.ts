import {
  createHolidayCalendarSchema,
  createHolidaySchema,
  electRestrictedHolidaySchema,
  holidayCalendarListQuerySchema,
  holidayImportSchema,
  restrictedHolidayQuerySchema,
  updateHolidayCalendarSchema,
  updateHolidaySchema,
} from '@vyuha/shared';
import { z } from 'zod';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';

/**
 * Nest-facing wrappers for the holiday slice. The schemas live in
 * `@vyuha/shared` so the web client's forms validate against the same rules;
 * this file only makes them findable by `ZodValidationPipe`.
 */

export class HolidayCalendarListQueryDto extends createZodDto(holidayCalendarListQuerySchema) {}
export class CreateHolidayCalendarDto extends createZodDto(createHolidayCalendarSchema) {}
export class UpdateHolidayCalendarDto extends createZodDto(updateHolidayCalendarSchema) {}

export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class UpdateHolidayDto extends createZodDto(updateHolidaySchema) {}
export class HolidayImportDto extends createZodDto(holidayImportSchema) {}

export class RestrictedHolidayQueryDto extends createZodDto(restrictedHolidayQuerySchema) {}
export class ElectRestrictedHolidayDto extends createZodDto(electRestrictedHolidaySchema) {}

/**
 * Withdrawal names the holiday in the path, so all that is left in the query is
 * whose election it is. Its own schema rather than reusing the elect body:
 * a DELETE carries no body, and a schema that also accepted `holidayId` would
 * let a caller name one holiday in the path and another in the query.
 */
export const withdrawRestrictedHolidayQuerySchema = z.object({
  employeeId: z.uuid().optional(),
});

export class WithdrawRestrictedHolidayQueryDto extends createZodDto(
  withdrawRestrictedHolidayQuerySchema,
) {}
