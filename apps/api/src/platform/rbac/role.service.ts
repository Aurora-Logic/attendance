import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateRoleInput,
  type RoleSummary,
  type UpdateRoleInput,
} from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { RbacAdminService } from './rbac-admin.service.js';
import { RoleRepository } from './role.repository.js';

/**
 * REQ-B-07: "Roles are user-defined bundles of permissions ... Admin can create
 * roles, edit permission sets, and assign multiple roles to a user."
 *
 * **What a seeded role may and may not do.** REQ-B-07 states no exemption for
 * the four seeded roles, and `roles.is_system` was documented from the start as
 * "protected from deletion, not from edits". So:
 *
 *   permissions   editable, with a reason, like any other role
 *   name          refused. `seed/seed.ts` reconciles by name, so a renamed
 *                 `Admin` becomes a second `Admin` on the next seed run and the
 *                 original silently stops being reconciled
 *   description   editable; nothing matches on it
 *   delete        refused. Same reason — the seed would recreate it, which is
 *                 not a delete, it is a delay
 *
 * A permission edit to a seeded role is reversible by re-seeding, and the audit
 * entry says which role and what changed. That is the "not silently
 * redefinable" part: the change is allowed, it is attributed, and it carries a
 * reason.
 *
 * Every write here takes a reason. Not because a role edit is destructive on
 * its own, but because it is the one edit that can lock an organisation out of
 * its own system, and six months later "who took audit.view off Operations, and
 * why" is a question somebody will ask.
 */

@Injectable()
export class RoleService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly rbacAdmin: RbacAdminService,
    private readonly auditContext: AuditContext,
  ) {}

  list(principal: Principal): Promise<RoleSummary[]> {
    return this.repository(principal).list();
  }

  async create(principal: Principal, input: CreateRoleInput): Promise<RoleSummary> {
    const repository = this.repository(principal);

    if ((await repository.findIdByName(input.name)) !== null) {
      throw AppError.conflict(`A role called "${input.name}" already exists.`, {
        name: input.name,
      });
    }

    const id = await this.insert(repository, input);

    if (input.permissions.length > 0) {
      await this.rbacAdmin.setRolePermissions(principal.orgId, id, input.permissions);
    }

    const summary = await this.readBack(repository, id);

    this.auditContext.record({
      action: 'role.created',
      entityType: 'role',
      entityId: id,
      before: null,
      after: { ...summary, reason: input.reason },
    });

    return summary;
  }

  async update(principal: Principal, id: string, input: UpdateRoleInput): Promise<RoleSummary> {
    const repository = this.repository(principal);

    const existing = await repository.summary(id);
    if (existing === null) throw AppError.notFound('Role', id);

    if (input.name !== undefined && input.name !== existing.name) {
      if (existing.isSystem) {
        throw new AppError(
          ERROR_CODES.SYSTEM_ROLE_PROTECTED,
          `"${existing.name}" is a seeded role and cannot be renamed. The seed reconciles roles ` +
            'by name, so a renamed one is recreated alongside the rename on the next run. Its ' +
            'permissions and description are editable.',
          { details: { roleId: id, name: existing.name } },
        );
      }
      const clash = await repository.findIdByName(input.name);
      if (clash !== null && clash !== id) {
        throw AppError.conflict(`A role called "${input.name}" already exists.`, {
          name: input.name,
        });
      }
    }

    const fields: { name?: string; description?: string | null } = {};
    if (input.name !== undefined) fields.name = input.name;
    if (input.description !== undefined) fields.description = input.description;

    const updated = await this.updateFields(repository, id, fields);
    if (!updated) throw AppError.notFound('Role', id);

    if (input.permissions !== undefined) {
      // Delegated so the REQ-B-07 last-holder invariant is checked by the code
      // that owns it. It runs inside its own transaction and rolls the change
      // back if this edit would leave nobody able to manage roles.
      await this.rbacAdmin.setRolePermissions(principal.orgId, id, input.permissions);
    }

    const summary = await this.readBack(repository, id);

    this.auditContext.record({
      action: 'role.updated',
      entityType: 'role',
      entityId: id,
      before: existing,
      // The reason rides on `after` rather than being a field of its own: the
      // diff in `AuditService` narrows to what changed, and a reason that
      // matched nothing on the before side is always a change.
      after: { ...summary, reason: input.reason },
    });

    return summary;
  }

  // Delete and restore are deliberately not here. They go through
  // `DELETE /masters/role/:id`, the same route every other soft-deletable
  // record uses, so the reason floor, the in-use refusal, the audit shape and
  // the recycle bin are one implementation rather than two. What is
  // role-specific -- seeded roles refusing, membership running through
  // `user_roles` -- lives in `role-soft-deletes.ts` as the registry's
  // `extraBlockers` hook.

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): RoleRepository {
    return new RoleRepository(this.db, orgContextOf(principal));
  }

  private async insert(repository: RoleRepository, input: CreateRoleInput): Promise<string> {
    try {
      return await repository.insert({ name: input.name, description: input.description ?? null });
    } catch (error: unknown) {
      // The unique index is partial on the living rows, so two requests racing
      // on the same name reach here rather than both succeeding.
      if (isUniqueViolation(error)) {
        throw AppError.conflict(`A role called "${input.name}" already exists.`, {
          name: input.name,
        });
      }
      throw error;
    }
  }

  private async updateFields(
    repository: RoleRepository,
    id: string,
    fields: { name?: string; description?: string | null },
  ): Promise<boolean> {
    try {
      return await repository.updateFields(id, fields);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(`A role called "${fields.name ?? ''}" already exists.`, {
          name: fields.name,
        });
      }
      throw error;
    }
  }

  private async readBack(repository: RoleRepository, id: string): Promise<RoleSummary> {
    const summary = await repository.summary(id);
    if (summary === null) {
      throw new Error(`Role ${id} was written but could not be read back.`);
    }
    return summary;
  }
}
