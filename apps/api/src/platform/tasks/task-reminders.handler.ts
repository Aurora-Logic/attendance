import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NOTIFICATION_EVENTS } from '@vyuha/shared';
import { isNull } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { organizations } from '../db/schema/index.js';
import { JobRegistry, type JobContext, type JobHandler, type JobResult } from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { NotificationDispatcher } from '../notifications/notification.dispatcher.js';
import { localDateIn } from './local-date.js';
import { TaskRepository } from './task.repository.js';

/**
 * REQ-V-08: due-today and overdue, once each morning in each organisation's
 * own day. Idempotency keys make a re-run silent — due-today is keyed on the
 * task and the date (one nudge per day it is due, which is one day), overdue
 * on the task alone (one nudge, not one every morning until somebody gives
 * in). Both go through the dispatcher, so a person who muted the Tasks group
 * hears nothing, exactly as REQ-V-08 asks.
 */
@Injectable()
export class TaskRemindersHandler implements JobHandler<'send-task-reminders'>, OnModuleInit {
  readonly jobName = 'send-task-reminders' as const;

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly registry: JobRegistry,
    private readonly notifications: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(payload: JobPayloads['send-task-reminders'], _context: JobContext): Promise<JobResult> {
    const now = new Date();
    let dueToday = 0;
    let overdue = 0;

    const orgs = await this.db
      .select({ id: organizations.id, timezone: organizations.timezone })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    for (const org of orgs) {
      const today = payload.date ?? localDateIn(now, org.timezone);
      const repository = new TaskRepository(this.db, { orgId: org.id, actorUserId: null });

      for (const task of await repository.dueOn(today)) {
        await this.notifications.emit({
          orgId: org.id,
          type: NOTIFICATION_EVENTS.TASK_DUE_TODAY,
          audience: { kind: 'employees', employeeIds: [task.assigneeId] },
          payload: { taskId: task.id, title: task.title, dueDate: task.dueDate, subjectLabel: task.subjectLabel ?? '' },
          idempotencyKey: `task-due-${task.id}-${today}`,
        });
        dueToday += 1;
      }
      for (const task of await repository.overdueOn(today)) {
        await this.notifications.emit({
          orgId: org.id,
          type: NOTIFICATION_EVENTS.TASK_OVERDUE,
          audience: { kind: 'employees', employeeIds: [task.assigneeId] },
          payload: { taskId: task.id, title: task.title, dueDate: task.dueDate, subjectLabel: task.subjectLabel ?? '' },
          idempotencyKey: `task-overdue-${task.id}`,
        });
        overdue += 1;
      }
    }

    return { organisations: orgs.length, dueToday, overdue };
  }
}
