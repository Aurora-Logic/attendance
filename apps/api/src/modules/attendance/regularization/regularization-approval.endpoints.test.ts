import { SYSTEM_ROLES, uuidv7 } from '@vyuha/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApprovalService } from '../../../platform/approvals/approval.service.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { attendanceAdjustments, regularizations, shiftAssignments, shifts } from '../schema/index.js';
import { RegularizationRepository } from './regularization.repository.js';

/**
 * Owner, 21 Aug 2026: corrections can no longer be raised - the screen, the
 * routes and the keys are gone - but a request that was already open stays
 * decidable from the Approvals inbox by whoever may edit attendance, and an
 * approval still writes its adjustment and recomputes the day. This file is
 * what proves the second half; the first half is the absence of the routes.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f9';

let harness: ApiHarness;
let hrToken: string;
let employeeToken: string;
let employeeId = '';
let requesterUserId = '';
let yesterday = '';
let runId = '';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  // preservePeople: an approval recomputes a day, and attendance_days pins its
  // employee through the reset, so people survive and codes carry a run id.
  harness = await ApiHarness.start(ORG_ID, 'Open Corrections Fixture Org', { preservePeople: true });
  runId = uuidv7().slice(-8);
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);

  employeeId = await harness.createEmployee({ code: `RG-OPEN-${runId}`, firstName: 'Open', lastName: 'Correction' });
  const employee = await harness.createUser({ email: scopedEmail('rg-open-employee'), roleIds: [employeeRoleId], employeeId });
  requesterUserId = employee.id;
  const hr = await harness.createUser({ email: scopedEmail('rg-open-hr'), roleIds: [hrRoleId] });
  employeeToken = (await harness.login(employee.email, employee.password)).token;
  hrToken = (await harness.login(hr.email, hr.password)).token;

  yesterday = isoDate(new Date(Date.now() - 86_400_000));
  const shiftRows = await harness.db
    .insert(shifts)
    .values({ orgId: ORG_ID, code: `RG-OPEN-${runId}`, name: 'Open Correction Shift (test only)', startTime: '09:00:00', endTime: '18:00:00', breakMinutes: 0 })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');
  await harness.db.insert(shiftAssignments).values({ orgId: ORG_ID, employeeId, shiftId, effectiveFrom: yesterday, effectiveTo: yesterday });
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('the corrections surface is gone (owner, 21 Aug 2026)', () => {
  it('no longer serves the raise, list or policy routes', async () => {
    expect((await harness.get('/regularizations', { token: employeeToken })).status).toBe(404);
    expect((await harness.get('/regularizations/policy', { token: employeeToken })).status).toBe(404);
    expect((await harness.post('/regularizations', { token: employeeToken, body: {} })).status).toBe(404);
    expect((await harness.get('/on-duty', { token: employeeToken })).status).toBe(404);
  });
});

describe('a request that was already open stays decidable from the inbox', () => {
  it('an attendance editor approves it, the adjustment lands, and the day is recomputed', async () => {
    const ctx = { orgId: ORG_ID, actorUserId: requesterUserId };
    const repository = new RegularizationRepository(harness.db, ctx);
    const requestedOut = new Date(`${yesterday}T18:00:00+05:30`);
    const regularizationId = await repository.insertRegularization({
      employeeId,
      date: yesterday,
      kind: 'MISSING_OUT',
      requestedIn: null,
      requestedOut,
      reason: 'Forgot to punch out before the corrections module was retired.',
      attachmentFileId: null,
    });
    const approval = await harness.resolve(ApprovalService).raise(ctx, {
      type: 'REGULARIZATION',
      subjectType: 'regularization',
      subjectId: regularizationId,
      subject: `Open Correction: missing out on ${yesterday}`,
      requesterUserId,
    });
    await repository.linkRegularizationApproval(regularizationId, approval.id);

    // The requester cannot decide their own request; HR holds attendance.edit and can.
    const refused = await harness.post(`/approvals/${approval.id}/approve`, { token: employeeToken, body: {} });
    expect(refused.status).toBe(403);
    const approved = await harness.post<{ status: string }>(`/approvals/${approval.id}/approve`, { token: hrToken, body: {} });
    expect(approved.status, approved.text).toBe(201);
    expect(approved.body.status).toBe('APPROVED');

    const row = await harness.db
      .select({ status: regularizations.status })
      .from(regularizations)
      .where(eq(regularizations.id, regularizationId));
    expect(row[0]?.status).toBe('APPROVED');
    const adjustments = await harness.db
      .select({ id: attendanceAdjustments.id })
      .from(attendanceAdjustments)
      .where(sql`${attendanceAdjustments.regularizationId} = ${regularizationId}`);
    expect(adjustments).toHaveLength(1);
  });
});
