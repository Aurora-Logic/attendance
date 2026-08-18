import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { employees } from '../db/schema/index.js';
import type { Principal } from '../rbac/principal.js';
import { TaskSubjectRegistry } from './task-subject.registry.js';

/**
 * REQ-V-02 names the employee as a subject outright, and employees are a
 * platform record, so the platform describes them itself. Any employee of
 * the organisation: a task "on" a person is not a read of their record,
 * and gating it on `employee.view` would stop a salesperson raising
 * "brief the new joiner" about somebody they cannot otherwise open.
 */
@Injectable()
export class EmployeeSubjectDescriber implements OnModuleInit {
  readonly subjectType = 'employee';

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly registry: TaskSubjectRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async describe(principal: Principal, id: string): Promise<{ label: string } | null> {
    const rows = await this.db
      .select({ firstName: employees.firstName, lastName: employees.lastName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.orgId, principal.orgId), eq(employees.id, id), isNull(employees.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { label: [row.firstName, row.lastName].filter((p) => p !== null && p !== '').join(' ') };
  }
}
