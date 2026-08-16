import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AgentAuthService } from './agent-auth.service.js';
import { SyncAgentController } from './sync-agent.controller.js';
import { SyncAgentService } from './sync-agent.service.js';
import { SyncPullSweepHandler } from './sync-pull-sweep.handler.js';
import { SyncStalenessHandler } from './sync-staleness.handler.js';
import { SyncSchedulerService } from './sync-scheduler.service.js';
import { SyncWriterService } from './sync-writer.service.js';

/**
 * The sync engine's platform module (09 §1: "integration, sync" in the shared
 * kernel). Phase 6b builds it outward from here — agent auth and the poll
 * surface first, transport and pull machinery once real Tally fixtures exist.
 *
 * `@Global()` because `AccessGuard` — provided at the application root —
 * resolves agent credentials through `AgentAuthService`, and the guard's
 * dependencies must be reachable without the rbac module importing sync.
 */
@Global()
@Module({
  // AuthModule for LoginRateLimiter: agent credential guesses share
  // sign-in's sliding window machinery, in their own scope. Notifications
  // for REQ-Q-04: the staleness sweep announces transitions.
  imports: [AuthModule, NotificationsModule],
  controllers: [SyncAgentController],
  providers: [AgentAuthService, SyncAgentService, SyncWriterService, SyncSchedulerService, SyncPullSweepHandler, SyncStalenessHandler],
  exports: [AgentAuthService, SyncSchedulerService],
})
export class SyncModule {}
