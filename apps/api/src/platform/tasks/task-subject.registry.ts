import { Injectable, Logger } from '@nestjs/common';

import type { Principal } from '../rbac/principal.js';

/**
 * REQ-V-02: what a task may hang off, and who says so.
 *
 * The platform holds the mechanism and every module says which of its
 * records may be a subject — the `JobRegistry` / `GoToSourceRegistry`
 * shape, for the same reason (D-17): a task on an invoice must not make the
 * tasks module import the sales module. A describer answers two questions
 * for one id: does it exist and may this principal see it (null if not),
 * and what is it called. The label is snapshotted onto the task; the type
 * and id are the link the client routes on, so the label going stale costs
 * a stale word and nothing else.
 */
export interface TaskSubjectDescriber {
  readonly subjectType: string;
  describe(principal: Principal, id: string): Promise<{ label: string } | null>;
}

@Injectable()
export class TaskSubjectRegistry {
  private readonly logger = new Logger(TaskSubjectRegistry.name);
  private readonly describers = new Map<string, TaskSubjectDescriber>();

  register(describer: TaskSubjectDescriber): void {
    if (this.describers.has(describer.subjectType)) {
      throw new Error(`Task subject "${describer.subjectType}" already has a describer registered.`);
    }
    this.describers.set(describer.subjectType, describer);
    this.logger.log({ msg: 'Task subject registered', subjectType: describer.subjectType });
  }

  find(subjectType: string): TaskSubjectDescriber | null {
    return this.describers.get(subjectType) ?? null;
  }

  types(): readonly string[] {
    return [...this.describers.keys()];
  }
}
