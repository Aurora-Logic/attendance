import {
  createDepartmentSchema,
  createDesignationSchema,
  createLocationSchema,
  masterListQuerySchema,
  updateDepartmentSchema,
  updateDesignationSchema,
  updateLocationSchema,
} from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * Nest-facing wrappers for the three org masters. The schemas live in
 * `@vyuha/shared` so the web client's forms validate against the same rules;
 * this file only makes them findable by `ZodValidationPipe`.
 */

export class MasterListQueryDto extends createZodDto(masterListQuerySchema) {}

export class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}
export class UpdateDepartmentDto extends createZodDto(updateDepartmentSchema) {}

export class CreateDesignationDto extends createZodDto(createDesignationSchema) {}
export class UpdateDesignationDto extends createZodDto(updateDesignationSchema) {}

export class CreateLocationDto extends createZodDto(createLocationSchema) {}
export class UpdateLocationDto extends createZodDto(updateLocationSchema) {}
