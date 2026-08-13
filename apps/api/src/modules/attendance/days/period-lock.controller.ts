import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { LockPeriodDto, PeriodLockQueryDto, UnlockPeriodDto } from './period-lock.dto.js';
import { PeriodLockService } from './period-lock.service.js';
import type { PeriodLockRow } from './period-lock.repository.js';

/**
 * `/api/v1/attendance/locks` (technical design §6, REQ-E-09). PRD §5 screen 19.
 *
 * **The permission matrix changed here.** REQ-E-09 says "Unlocking requires
 * Admin", and until now there was no key that could express it — docs/
 * OPEN-QUESTIONS P2-1 recorded that gating unlock on `attendance.lock` makes
 * unlock exactly as available as lock, which is not what the requirement says,
 * and that nothing may branch on a role name to make up the difference. So
 * `attendance.unlock` now exists and is granted to Admin only. HR closes a
 * month; only Admin reopens one.
 *
 * `DELETE` carries a body, which reads oddly and is what §6 specifies:
 * `DELETE /attendance/locks/:id { reason }`. It is also a delete only in the
 * REST sense — the row survives with `unlocked_at` set, because "who locked
 * March, who reopened it, and why" has to outlive the lock.
 */
@Controller('attendance/locks')
export class PeriodLockController {
  constructor(private readonly locks: PeriodLockService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ATTENDANCE_LOCK, PERMISSIONS.ATTENDANCE_UNLOCK)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: PeriodLockQueryDto,
  ): Promise<{ data: PeriodLockRow[] }> {
    return this.locks.list(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ATTENDANCE_LOCK)
  @HttpCode(HttpStatus.CREATED)
  lock(@CurrentUser() principal: Principal, @Body() body: LockPeriodDto): Promise<PeriodLockRow> {
    return this.locks.lock(principal, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.ATTENDANCE_UNLOCK)
  unlock(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UnlockPeriodDto,
  ): Promise<PeriodLockRow> {
    return this.locks.unlock(principal, id, body.reason);
  }
}
