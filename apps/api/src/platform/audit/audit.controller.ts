import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS, type CursorPaginated } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { AuditLogQueryDto } from './audit.dto.js';
import { AuditLogService, type AuditFacets, type AuditLogEntryView } from './audit-log.service.js';

/**
 * Technical design §6: `GET /audit-logs`. REQ-M-02's viewer.
 *
 * Read-only by construction and not by convention. There is no POST, PATCH or
 * DELETE here and there never will be: REQ-M-01 makes the table append-only,
 * the migration revokes UPDATE and DELETE on it from the application role, and
 * `AuditService` is the only writer in the process.
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: AuditLogQueryDto,
  ): Promise<CursorPaginated<AuditLogEntryView>> {
    return this.auditLogs.list(principal, query);
  }

  /**
   * The values present in this organisation's trail, for the viewer's filters.
   *
   * A hardcoded list of actions on the client would go stale the first time a
   * new endpoint was added, and would offer filters that match nothing.
   */
  @Get('facets')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  facets(@CurrentUser() principal: Principal): Promise<AuditFacets> {
    return this.auditLogs.facets(principal);
  }
}
