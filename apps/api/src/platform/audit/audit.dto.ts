import { MAX_PAGE_SIZE } from '@vyuha/shared';
import { z } from 'zod';

import { createZodDto } from '../common/zod-validation.pipe.js';

/**
 * `GET /audit-logs` (REQ-M-02).
 *
 * Cursor rather than page (technical design §6). The trail grows while it is
 * being read, so an offset-paged viewer repeats rows on page two every time a
 * request is audited between the two fetches.
 */

/** Both are `datetime-local`-free ISO instants; the client sends what it filtered on. */
const instant = z.iso.datetime({ offset: true }).or(z.iso.datetime());

export const auditLogQuerySchema = z.object({
  entityType: z.string().trim().min(1).max(64).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  from: instant.optional(),
  to: instant.optional(),
  /** Opaque. Produced by this endpoint and never constructed by the client. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}
