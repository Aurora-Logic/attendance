import {
  createEmployeeSchema,
  employeeListQuerySchema,
  employeeImportSchema,
  updateEmployeeSchema,
} from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * The Nest-facing wrappers. The schemas themselves live in `@vyuha/shared` so
 * the web client validates the same shapes before it posts them; this file is
 * only the adapter that lets `ZodValidationPipe` find them from a parameter's
 * declared type.
 */

export class EmployeeListQueryDto extends createZodDto(employeeListQuerySchema) {}
export class CreateEmployeeDto extends createZodDto(createEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(updateEmployeeSchema) {}
export class EmployeeImportDto extends createZodDto(employeeImportSchema) {}
