import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, employeeDisplayName, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../search/go-to-source.registry.js';
import { EmployeeService } from './employee.service.js';

/**
 * Employees in Go To (REQ-O-05, "employees first").
 *
 * Registered the way every other cross-module attachment is — it puts itself
 * into the registry during `onModuleInit`, and `platform/search/` never
 * imports this file.
 *
 * The search itself is `EmployeeService.list`, not a query of this file's own.
 * That is a deliberate reuse of authority: the service resolves the caller's
 * scope through `ScopeService` and escapes the term's wildcards, so Go To
 * finds exactly the people the employee register would show this caller — the
 * same names, under the same team boundary, with no second copy of either
 * rule to drift.
 */
@Injectable()
export class EmployeeGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'employee';

  /**
   * The register's own read key. `EMPLOYEE_SCOPE_GRANTS` maps it to team
   * breadth and widens to the organisation on `employee.manage`, inside the
   * service this source delegates to.
   */
  readonly permissions = [PERMISSIONS.EMPLOYEE_VIEW] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly employees: EmployeeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.employees.list(principal, {
      page: 1,
      pageSize: limit,
      q: term,
    });

    return data.map((employee) => ({
      type: this.recordType,
      id: employee.id,
      title: employeeDisplayName(employee.firstName, employee.lastName),
      subtitle: [
        employee.employeeCode,
        employee.designation?.name ?? employee.department?.name ?? null,
        // A retired or suspended person is still findable — history points at
        // them — but the palette must not read as if they are on the roster.
        employee.status === 'ACTIVE' ? null : employee.status,
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
      code: employee.employeeCode,
    }));
  }
}
