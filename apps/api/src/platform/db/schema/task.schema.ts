import { boolean, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../columns.js';
import { organizations } from './organizations.schema.js';
import { employees } from './people.schema.js';

/**
 * Tasks (08 Area V, D-17): platform, not CRM. The subject is polymorphic —
 * `(subject_type, subject_id)` like `approval_requests` — so a task may hang
 * off a contact, an invoice, an employee, or nothing, and no module has to
 * import another to attach one.
 *
 * Status is the board column (REQ-V-03): "columns are configuration, not
 * code", so what "done" means is `task_board_columns.is_done`, and closing a
 * task is moving it into such a column. `closed_at` is set by that move so
 * "closed last week" is answerable without replaying the audit log.
 */

export const taskPriorityEnum = pgEnum('task_priority', ['LOW', 'MEDIUM', 'HIGH']);

export const taskBoardColumns = pgTable(
  'task_board_columns',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isDone: boolean('is_done').notNull().default(false),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('task_board_columns_org_name_uq').on(t.orgId, t.name).where(ALIVE),
    index('task_board_columns_org_sort_idx').on(t.orgId, t.sortOrder),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    /** The subject's name when attached. A snapshot: the label is display, the ids are the link. */
    subjectLabel: text('subject_label'),
    /** Employees, like every scoped record (08 §2.1: a salesperson is an employee). */
    assigneeId: uuid('assignee_id').references(() => employees.id, { onDelete: 'restrict' }),
    ownerId: uuid('owner_id').references(() => employees.id, { onDelete: 'restrict' }),
    dueDate: date('due_date', { mode: 'string' }),
    priority: taskPriorityEnum('priority').notNull().default('MEDIUM'),
    columnId: uuid('column_id')
      .notNull()
      .references(() => taskBoardColumns.id, { onDelete: 'restrict' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (t) => [
    index('tasks_org_assignee_due_idx').on(t.orgId, t.assigneeId, t.dueDate).where(ALIVE),
    index('tasks_org_owner_idx').on(t.orgId, t.ownerId).where(ALIVE),
    index('tasks_org_column_idx').on(t.orgId, t.columnId).where(ALIVE),
    index('tasks_org_subject_idx').on(t.orgId, t.subjectType, t.subjectId).where(ALIVE),
    // The reminder sweep: open tasks by due date, across the organisation.
    index('tasks_org_due_open_idx').on(t.orgId, t.dueDate).where(ALIVE),
  ],
);
