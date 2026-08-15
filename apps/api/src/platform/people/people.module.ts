import { Module } from '@nestjs/common';

import { EmployeeAccessController } from './employee-access.controller.js';
import { EmployeeAccessService } from './employee-access.service.js';
import { EmployeeDataExportController } from './employee-data-export.controller.js';
import { EmployeeDataExportHandler } from './employee-data-export.handler.js';
import { EmployeeDataExportService } from './employee-data-export.service.js';
import { EmployeeController } from './employee.controller.js';
import { EmployeeService } from './employee.service.js';

/**
 * Employee master data. Exported because attendance, leave and approvals all
 * need to ask about an employee, and the alternative -- each of them querying
 * `employees` directly -- is how the scoping rules end up with four
 * implementations and three of them wrong.
 *
 * Nothing is imported. `DbModule`, `AuditModule`, `FileModule`, `RbacModule`
 * and `JobsModule` are all `@Global()`, and `EmployeeDataExportHandler` puts
 * itself into the global job registry during `onModuleInit` (REQ-M-05).
 */
@Module({
  controllers: [EmployeeController, EmployeeAccessController, EmployeeDataExportController],
  providers: [
    EmployeeService,
    EmployeeAccessService,
    EmployeeDataExportService,
    EmployeeDataExportHandler,
  ],
  exports: [EmployeeService],
})
export class PeopleModule {}
