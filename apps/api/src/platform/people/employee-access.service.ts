import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  SYSTEM_ROLES,
  type AssignRoleInput,
  type EmployeeAccess,
} from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { hashPassword } from '../auth/password.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { employees, roles, userRoles, users } from '../db/schema/index.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { RbacAdminService } from '../rbac/rbac-admin.service.js';
import { EmployeeAccessRepository } from './employee-access.repository.js';

export interface SetCredentialsInput {
  readonly email: string;
  readonly password: string;
  readonly roleId?: string | undefined;
  readonly reason?: string | undefined;
}

/**
 * REQ-B-07's missing half: granting and revoking a role on a person.
 *
 * Roles could be created and edited but never handed to anybody, so the
 * requirement's acceptance -- "a new role created in the UI grants and denies
 * correctly" -- could not be exercised end to end (OPEN-QUESTIONS P2-3).
 *
 * **Every membership write goes through `RbacAdminService` and nothing here
 * touches `user_roles`.** That service owns the invariant "the last account
 * holding `roles.manage` cannot be stripped of it", enforced by making the
 * change inside a locking transaction and counting the survivors afterwards.
 * Writing the delete here -- even "just this once, it is only one row" -- would
 * be a second path to the same table with none of that, and the invariant would
 * hold on the roles screen and not on the employee screen.
 *
 * What this service does own is everything the RBAC layer has no opinion about:
 * that the employee exists in this organisation, that they have a login at all,
 * that the role is one of this organisation's, and the audit entry.
 */
@Injectable()
export class EmployeeAccessService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly rbacAdmin: RbacAdminService,
    private readonly auditContext: AuditContext,
  ) {}

  async read(principal: Principal, employeeId: string): Promise<EmployeeAccess> {
    const repository = this.repository(principal);
    await this.requireEmployee(repository, employeeId);
    return this.compose(repository, employeeId);
  }

  async setCredentials(
    principal: Principal,
    employeeId: string,
    input: SetCredentialsInput,
  ): Promise<EmployeeAccess> {
    const repository = this.repository(principal);
    const employee = await this.requireEmployee(repository, employeeId);
    const existingAccount = await repository.findAccount(employeeId);
    const passwordHash = await hashPassword(input.password);
    const targetEmail = input.email.toLowerCase().trim();

    if (existingAccount === null) {
      // Check if email already in use
      const emailConflict = await this.db
        .select({ id: users.id, orgId: users.orgId })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${targetEmail}`, isNull(users.deletedAt)))
        .limit(1);

      if (emailConflict[0] !== undefined) {
        throw AppError.conflict('That email address is already in use by another account.');
      }

      await this.db.transaction(async (tx) => {
        const [insertedUser] = await tx
          .insert(users)
          .values({
            orgId: principal.orgId,
            employeeId,
            email: targetEmail,
            passwordHash,
            status: 'ACTIVE',
            passwordChangedAt: new Date(),
            createdBy: principal.userId,
            updatedBy: principal.userId,
          })
          .returning({ id: users.id });

        if (insertedUser === undefined) {
          throw new Error('User creation returned no row.');
        }

        // Update employee's work email if not set
        await tx
          .update(employees)
          .set({ workEmail: targetEmail, updatedAt: new Date(), updatedBy: principal.userId })
          .where(and(eq(employees.id, employeeId), isNull(employees.workEmail)));

        // Assign specified role or default Employee role
        let roleIdToAssign = input.roleId;
        if (roleIdToAssign === undefined) {
          const defaultRole = await tx
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(
                eq(roles.orgId, principal.orgId),
                eq(roles.name, SYSTEM_ROLES.EMPLOYEE),
                isNull(roles.deletedAt),
              ),
            )
            .limit(1);
          roleIdToAssign = defaultRole[0]?.id;
        }

        if (roleIdToAssign !== undefined) {
          await tx
            .insert(userRoles)
            .values({ userId: insertedUser.id, roleId: roleIdToAssign, createdBy: principal.userId })
            .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] });
        }
      });

      this.auditContext.record({
        action: 'user.created',
        entityType: 'employee',
        entityId: employee.id,
        after: { email: targetEmail, reason: input.reason ?? 'Direct credential provisioning' },
      });
    } else {
      // Update existing account
      await this.db
        .update(users)
        .set({
          email: targetEmail,
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'ACTIVE',
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
          updatedBy: principal.userId,
        })
        .where(eq(users.id, existingAccount.id));

      if (input.roleId !== undefined) {
        await this.rbacAdmin.assignRoleToUser(principal.orgId, existingAccount.id, input.roleId);
      }

      this.auditContext.record({
        action: 'user.password_reset',
        entityType: 'employee',
        entityId: employee.id,
        after: { accountId: existingAccount.id, email: targetEmail, reason: input.reason ?? 'Direct password update' },
      });
    }

    return this.compose(repository, employeeId);
  }

  async assign(
    principal: Principal,
    employeeId: string,
    input: AssignRoleInput,
  ): Promise<EmployeeAccess> {
    const repository = this.repository(principal);
    const employee = await this.requireEmployee(repository, employeeId);
    const account = await this.requireAccount(repository, employeeId, employee.label);
    const role = await this.requireRole(repository, input.roleId);

    const before = await this.compose(repository, employeeId);

    await this.rbacAdmin.assignRoleToUser(principal.orgId, account.id, role.id);

    const after = await this.compose(repository, employeeId);

    this.record(employee, account.id, input.reason, before, after, 'user.role_assigned');
    return after;
  }

  async revoke(
    principal: Principal,
    employeeId: string,
    roleId: string,
    reason: string,
  ): Promise<EmployeeAccess> {
    const repository = this.repository(principal);
    const employee = await this.requireEmployee(repository, employeeId);
    const account = await this.requireAccount(repository, employeeId, employee.label);
    const role = await this.requireRole(repository, roleId);

    const before = await this.compose(repository, employeeId);

    // Throws LAST_ROLES_MANAGE_HOLDER and rolls its own transaction back when
    // this would leave nobody able to manage roles. Nothing is caught here: the
    // refusal is the answer, and translating it would only blur it.
    await this.rbacAdmin.removeRoleFromUser(principal.orgId, account.id, role.id);

    const after = await this.compose(repository, employeeId);

    this.record(employee, account.id, reason, before, after, 'user.role_removed');
    return after;
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): EmployeeAccessRepository {
    return new EmployeeAccessRepository(this.db, orgContextOf(principal));
  }

  private async compose(
    repository: EmployeeAccessRepository,
    employeeId: string,
  ): Promise<EmployeeAccess> {
    const account = await repository.findAccount(employeeId);
    // No account means no roles, and asking for them would be a query whose
    // answer is structurally empty.
    const roles = account === null ? [] : await repository.rolesOf(account.id);
    return { employeeId, account, roles };
  }

  private async requireEmployee(
    repository: EmployeeAccessRepository,
    employeeId: string,
  ): Promise<{ id: string; label: string }> {
    const employee = await repository.findEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);
    return employee;
  }

  /**
   * REQ-B-02 allows an employee with no login, and REQ-A-06 imports create
   * exactly those. A role has nothing to attach to until they are invited, and
   * saying so is more use than a generic 404 that reads as a wrong address.
   */
  private async requireAccount(
    repository: EmployeeAccessRepository,
    employeeId: string,
    label: string,
  ): Promise<{ id: string }> {
    const account = await repository.findAccount(employeeId);
    if (account === null) {
      throw AppError.validation(
        `${label} has no login account, so there is nothing to hold a role. Invite them first.`,
        { fields: [{ path: 'employeeId', message: 'no login account' }] },
      );
    }
    if (account.status === 'SUSPENDED') {
      // A suspended account is not counted as a `roles.manage` holder, so
      // granting it the role would look like it satisfied the invariant while
      // leaving the organisation locked out. Refused rather than quietly
      // allowed, because the fix is to reactivate the account first.
      throw new AppError(
        ERROR_CODES.ACCOUNT_INACTIVE,
        `${label}'s account is suspended. A suspended account cannot sign in, so a role granted ` +
          'to it would confer nothing. Reactivate the account first.',
        { details: { accountStatus: account.status } },
      );
    }
    return { id: account.id };
  }

  private async requireRole(
    repository: EmployeeAccessRepository,
    roleId: string,
  ): Promise<{ id: string; name: string }> {
    const role = await repository.findRole(roleId);
    // `RbacAdminService.assignRoleToUser` inserts on the id it is handed and
    // does not ask whose organisation the role belongs to -- it is also called
    // by the invitation flow, which has already resolved one. Checking here is
    // what stops a crafted body attaching another organisation's role.
    if (role === null) throw AppError.notFound('Role', roleId);
    return role;
  }

  private record(
    employee: { id: string; label: string },
    accountId: string,
    reason: string,
    before: EmployeeAccess,
    after: EmployeeAccess,
    action: 'user.role_assigned' | 'user.role_removed',
  ): void {
    this.auditContext.record({
      action,
      // The employee, not the account: that is the record an administrator
      // opens, and REQ-M-02's per-record history filters on this id.
      entityType: 'employee',
      entityId: employee.id,
      before: auditShape(before),
      // The reason rides on `after` for the same reason it does on a role edit:
      // `diffJson` narrows to what moved, and a reason that matched nothing on
      // the before side is always part of the change.
      after: { ...auditShape(after), accountId, reason },
    });
  }
}

/**
 * What goes in the diff: the role names, and nothing else.
 *
 * The permission keys are excluded on purpose. They belong to the role and can
 * change without anybody touching this person, so putting them here would make
 * an assignment entry claim a permission change that a role edit actually made.
 * The account's own email and status are excluded for the same reason -- this
 * endpoint cannot change either.
 */
function auditShape(access: EmployeeAccess): Record<string, unknown> {
  return { roles: access.roles.map((role) => role.name) };
}
