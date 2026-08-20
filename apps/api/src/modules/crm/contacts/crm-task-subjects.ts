import { Injectable, type OnModuleInit } from '@nestjs/common';

import { AppError } from '../../../platform/common/errors.js';
import type { Principal } from '../../../platform/rbac/principal.js';
import { TaskSubjectRegistry } from '../../../platform/tasks/task-subject.registry.js';
import { CrmService } from './crm.service.js';

/**
 * REQ-V-02: a task may hang off a contact or a company. Both go through
 * `CrmService`, so a subject the caller could not open is a subject they
 * cannot attach a task to — the same scope, asked the same way.
 */
@Injectable()
export class CrmTaskSubjects implements OnModuleInit {
  constructor(
    private readonly registry: TaskSubjectRegistry,
    private readonly crm: CrmService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      subjectType: 'contact',
      describe: async (principal: Principal, id: string) => {
        const contact = await this.visible(() => this.crm.findContact(principal, id));
        return contact === null
          ? null
          : { label: contact.companyName === null ? contact.name : `${contact.name} · ${contact.companyName}` };
      },
    });
    this.registry.register({
      subjectType: 'company',
      describe: async (principal: Principal, id: string) => {
        const company = await this.visible(() => this.crm.findCompany(principal, id));
        return company === null ? null : { label: company.name };
      },
    });
  }

  /** Not-found and not-visible are one answer here; anything else is still an error. */
  private async visible<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error: unknown) {
      if (error instanceof AppError && error.status === 404) return null;
      throw error;
    }
  }
}
