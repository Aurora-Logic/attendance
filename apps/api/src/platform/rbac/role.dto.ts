import { createRoleSchema, updateRoleSchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * Nest-facing wrappers for REQ-B-07. The schemas live in `@vyuha/shared` so the
 * roles screen holds its save button to the same rules the server enforces —
 * including the reason floor, which the user should be told about while typing
 * rather than after pressing save.
 */

export class CreateRoleDto extends createZodDto(createRoleSchema) {}
export class UpdateRoleDto extends createZodDto(updateRoleSchema) {}
