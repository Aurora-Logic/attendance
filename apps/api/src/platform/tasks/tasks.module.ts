import { Global, Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { EmployeeSubjectDescriber } from './employee-subject.describer.js';
import { TaskRemindersHandler } from './task-reminders.handler.js';
import { TaskSubjectRegistry } from './task-subject.registry.js';
import { TaskController } from './task.controller.js';
import { TaskService } from './task.service.js';

/**
 * Tasks (08 Area V), in the platform by decision D-17.
 *
 * `@Global()` for the registry's sake, like `SearchModule`: a module that
 * wants its records to be task subjects registers a describer during its
 * own init, and must be able to reach the registry without an import edge
 * from the platform back to it.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [TaskController],
  providers: [TaskSubjectRegistry, TaskService, EmployeeSubjectDescriber, TaskRemindersHandler],
  exports: [TaskSubjectRegistry],
})
export class TasksModule {}
