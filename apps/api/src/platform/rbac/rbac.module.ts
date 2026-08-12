import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AccessGuard } from './access.guard.js';
import { PrincipalService } from './principal.service.js';
import { RbacAdminService } from './rbac-admin.service.js';
import { RoutePolicyAudit } from './route-policy.audit.js';
import { ScopeService } from './scope.service.js';

/**
 * Global for the same reason `DbModule` is: attendance, CRM, and ERP will all
 * need `ScopeService` and the guard, and a second local copy of either would
 * be a second place for the scope rules to live.
 *
 * The guard is deliberately *not* registered here. It is bound in
 * `AppModule` with `APP_GUARD` so that the file listing the application's
 * global behaviour also shows that everything is guarded -- a reader of
 * `app.module.ts` should not have to open a submodule to find that out.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [AccessGuard, PrincipalService, ScopeService, RbacAdminService, RoutePolicyAudit],
  exports: [AccessGuard, PrincipalService, ScopeService, RbacAdminService],
})
export class RbacModule {}
