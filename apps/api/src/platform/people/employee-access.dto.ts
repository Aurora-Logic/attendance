import { assignRoleSchema, reasonBodySchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * Nest-facing wrappers for REQ-B-07's assignment routes.
 *
 * The schemas live in `@vyuha/shared` so the employee screen holds its confirm
 * button to the same reason floor the server enforces -- the reader learns the
 * rule while typing rather than from a 400.
 *
 * The revoke body is `reasonBodySchema`, the same one every destructive route
 * in this product takes. Taking a role away is a destructive act: somebody who
 * could approve leave this morning cannot this afternoon, and six months later
 * "why" is a question with exactly one place to look.
 */
export class AssignRoleDto extends createZodDto(assignRoleSchema) {}
export class RevokeRoleDto extends createZodDto(reasonBodySchema) {}
