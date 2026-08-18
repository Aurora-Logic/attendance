import { Module } from '@nestjs/common';

import { CompanyController, ContactController } from './contacts/crm.controller.js';
import { CompanyGoToSource, ContactGoToSource } from './contacts/contact-goto.source.js';
import { CrmService } from './contacts/crm.service.js';
import { CrmTaskSubjects } from './contacts/crm-task-subjects.js';

/**
 * The CRM module (09 §4.4, 08 §7). Contacts and companies now; pipelines,
 * deals and activities as their slices land. Tasks are deliberately absent —
 * they are platform (D-17).
 *
 * Nothing imported: the platform modules it leans on (`DbModule`,
 * `AuditModule`, `RbacModule`) are `@Global()`. ESLint holds the boundary in
 * the other direction and between siblings — `modules/crm` may not import
 * `modules/attendance` or the sales module when it exists.
 */
@Module({
  controllers: [ContactController, CompanyController],
  providers: [CrmService, ContactGoToSource, CompanyGoToSource, CrmTaskSubjects],
})
export class CrmModule {}
