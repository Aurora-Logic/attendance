import { Module } from '@nestjs/common';

import { EmployeeController } from './employee.controller.js';
import { EmployeeService } from './employee.service.js';

/**
 * Employee master data. Exported because attendance, leave and approvals all
 * need to ask about an employee, and the alternative -- each of them querying
 * `employees` directly -- is how the scoping rules end up with four
 * implementations and three of them wrong.
 */
@Module({
  controllers: [EmployeeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class PeopleModule {}
