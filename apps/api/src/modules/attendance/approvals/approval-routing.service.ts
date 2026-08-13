import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';

/**
 * Who a request routes to, when nobody said.
 *
 * REQ-G-09 states the shape for leave -- "routes to the reporting manager,
 * then HR" -- and REQ-I-05 states what happens when that lands on the
 * requester themselves: "it routes to the next level up". Both are answered by
 * one ordered list of candidates, so the raise path and the escalation job
 * cannot disagree about who the next level is.
 *
 * The list is a suggestion, not a policy. A slice that knows its own route --
 * a leave type configured for two-step approval, say -- passes it explicitly
 * and this service is not consulted. What it exists for is the default, and
 * for the escalation job, which by definition has nobody to ask.
 */

/**
 * How far up the reporting line to look.
 *
 * REQ-A-07 forbids a cycle in the chain and validates on save, but a cycle
 * introduced by a repair script would make an uncapped recursion run until
 * Postgres ran out of memory. Ten levels is far more than any real hierarchy
 * and is a bound rather than a rule.
 */
const MAX_CHAIN_DEPTH = 10;

@Injectable()
export class ApprovalRoutingService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  /**
   * The default route for a request raised by this user: their reporting line
   * from the bottom up, then everyone who can approve for the whole
   * organisation.
   *
   * The HR tail is what makes REQ-I-05 and REQ-G-09 terminate. Without it, a
   * request raised by the person at the top of the reporting line would have
   * an empty route, and an escalation with nowhere to go would leave the
   * request pending forever with no explanation.
   */
  async defaultRoute(orgId: string, requesterUserId: string): Promise<string[]> {
    const [managers, approveAll] = await Promise.all([
      this.managerChain(orgId, requesterUserId),
      this.orgWideApprovers(orgId),
    ]);

    const route: string[] = [];
    for (const userId of [...managers, ...approveAll]) {
      if (userId === requesterUserId) continue;
      if (route.includes(userId)) continue;
      route.push(userId);
    }
    return route;
  }

  /**
   * The user accounts of the requester's managers, nearest first.
   *
   * A recursive CTE in one round trip rather than a loop of queries, for the
   * reason `ScopeService` gives about the same walk: one query per level of
   * the hierarchy is a query count nobody notices until the hierarchy is deep.
   *
   * A manager with no user account (REQ-B-02) is skipped rather than ending
   * the walk -- they cannot be sent an approval, but the person above them
   * can.
   */
  async managerChain(orgId: string, requesterUserId: string): Promise<string[]> {
    const rows = await this.db.execute<{ user_id: string }>(sql`
      WITH RECURSIVE vy_chain AS (
        SELECT e.reporting_manager_id AS id, 1 AS depth
          FROM users u
          JOIN employees e ON e.id = u.employee_id
         WHERE u.id = ${requesterUserId}
           AND u.org_id = ${orgId}
           AND e.org_id = ${orgId}
           AND e.deleted_at IS NULL
           AND e.reporting_manager_id IS NOT NULL
        UNION ALL
        SELECT m.reporting_manager_id, vy_chain.depth + 1
          FROM employees m
          JOIN vy_chain ON m.id = vy_chain.id
         WHERE m.org_id = ${orgId}
           AND m.deleted_at IS NULL
           AND m.reporting_manager_id IS NOT NULL
           AND vy_chain.depth < ${MAX_CHAIN_DEPTH}
      )
      SELECT u.id AS user_id
        FROM vy_chain
        JOIN users u
          ON u.employee_id = vy_chain.id
         AND u.org_id = ${orgId}
         AND u.deleted_at IS NULL
         AND u.status = 'ACTIVE'
       ORDER BY vy_chain.depth
    `);
    return rows.rows.map((row) => row.user_id);
  }

  /**
   * Everyone in the organisation holding `leave.approve.all`.
   *
   * Resolved through the permission catalogue rather than by role name, for
   * the reason `route-policy.ts` states: PRD §2 says nothing in this codebase
   * may branch on a role name, and "HR" is a role somebody can rename.
   */
  async orgWideApprovers(orgId: string): Promise<string[]> {
    const rows = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT u.id AS user_id, u.email
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       WHERE u.org_id = ${orgId}
         AND u.deleted_at IS NULL
         AND u.status = 'ACTIVE'
         AND p.key = ${PERMISSIONS.LEAVE_APPROVE_ALL}
       ORDER BY u.email
    `);
    return rows.rows.map((row) => row.user_id);
  }
}
