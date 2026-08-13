import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYSTEM_ROLES, type EmployeeImportReport } from '@vyuha/shared';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-A-06 over HTTP.
 *
 * The planner is unit-tested against maps; this asserts the two things only a
 * real request can: that validate writes nothing, and that a commit with bad
 * rows in it still creates the good ones.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e6';

let harness: ApiHarness;
let hrToken: string;
let employeeToken: string;
let runId: string;

async function countEmployees(prefix: string): Promise<number> {
  const result = await harness.get<{ meta: { total: number } }>(`/employees?q=${prefix}&pageSize=1`,
    { token: hrToken },
  );
  return result.body?.meta.total ?? -1;
}

function row(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    employeeCode: code,
    firstName: 'Imported',
    dateOfJoining: '2026-02-02',
    ...overrides,
  };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Vyuha Import Test');
  runId = Math.random().toString(36).slice(2, 8).toUpperCase();

  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  const hr = await harness.createUser({
    email: scopedEmail('import.hr'),
    roleIds: [hrRoleId],
  });
  const plain = await harness.createUser({
    email: scopedEmail('import.employee'),
    roleIds: [employeeRoleId],
  });
  hrToken = (await harness.login(hr.email, hr.password)).token;
  employeeToken = (await harness.login(plain.email, plain.password)).token;
  expect([hrToken, employeeToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('POST /employees/import/validate (REQ-A-06)', () => {
  it('reports the plan and creates nothing', async () => {
    const code = `IMP-${runId}-1`;
    const before = await countEmployees(`IMP-${runId}`);

    const result = await harness.post<EmployeeImportReport>('/employees/import/validate',
      { token: hrToken, body: { rows: [row(code)] } },
    );

    expect(result.status).toBe(200);
    expect(result.body?.committed).toBe(false);
    expect(result.body?.counts).toEqual({ CREATE: 1, ERROR: 0 });
    // The claim that matters: a preview is a preview.
    expect(await countEmployees(`IMP-${runId}`)).toBe(before);
  });

  it('names the row number a person can find in their sheet', async () => {
    const result = await harness.post<EmployeeImportReport>('/employees/import/validate',
      {
        token: hrToken,
        body: { rows: [row(`IMP-${runId}-OK`), row(`IMP-${runId}-BAD`, { location: 'Atlantis' })] },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body?.rows[1]).toMatchObject({ rowNumber: 2, action: 'ERROR' });
    expect(result.body?.rows[1]?.errors[0]).toContain('Atlantis');
  });

  it('refuses an empty file rather than answering with an empty plan', async () => {
    const result = await harness.post('/employees/import/validate', {
      token: hrToken,
      body: { rows: [] },
    });
    expect(result.status).toBe(400);
  });
});

describe('POST /employees/import/commit (REQ-A-06)', () => {
  it('creates the good rows and reports the bad ones', async () => {
    const good = `IMP-${runId}-G`;
    const bad = `IMP-${runId}-B`;

    const result = await harness.post<EmployeeImportReport>('/employees/import/commit',
      {
        token: hrToken,
        body: { rows: [row(good), row(bad, { employmentType: 'PART_TIME_ISH' })] },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body?.committed).toBe(true);
    expect(result.body?.createdCount).toBe(1);
    expect(result.body?.counts).toEqual({ CREATE: 1, ERROR: 1 });

    // Partial commit is the point of REQ-A-06: one typo must not cost the
    // other ninety-nine rows.
    const found = await harness.get<{ data: { employeeCode: string }[] }>(`/employees?q=${good}`,
      { token: hrToken },
    );
    expect(found.body?.data.map((e) => e.employeeCode)).toEqual([good]);

    const missing = await harness.get<{ data: unknown[] }>(`/employees?q=${bad}`,
      { token: hrToken },
    );
    expect(missing.body?.data).toHaveLength(0);
  });

  it('links a manager who is created by the same file', async () => {
    const manager = `IMP-${runId}-M`;
    const report = `IMP-${runId}-R`;

    // Deliberately listed before their manager: a file is written in whatever
    // order somebody typed it, and an importer that only works top-down would
    // fail on half of them.
    const result = await harness.post<EmployeeImportReport>('/employees/import/commit',
      {
        token: hrToken,
        body: { rows: [row(report, { reportingManagerCode: manager }), row(manager)] },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body?.createdCount).toBe(2);

    const found = await harness.get<{
      data: { employeeCode: string; reportingManager: { name: string } | null }[];
    }>(`/employees?q=${report}`, { token: hrToken });
    expect(found.body?.data[0]?.reportingManager).not.toBeNull();
  });

  it('refuses a loop that neither row is wrong on its own (REQ-A-07)', async () => {
    const a = `IMP-${runId}-CA`;
    const b = `IMP-${runId}-CB`;

    const result = await harness.post<EmployeeImportReport>('/employees/import/commit',
      {
        token: hrToken,
        body: {
          rows: [
            row(a, { reportingManagerCode: b }),
            row(b, { reportingManagerCode: a }),
          ],
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body?.createdCount).toBe(0);
    expect(await countEmployees(a)).toBe(0);
  });

  it('refuses a code that already exists, without disturbing the record that has it', async () => {
    const code = `IMP-${runId}-DUP`;
    await harness.post('/employees/import/commit', {
      token: hrToken,
      body: { rows: [row(code, { firstName: 'Original' })] },
    });

    const second = await harness.post<EmployeeImportReport>('/employees/import/commit',
      { token: hrToken, body: { rows: [row(code, { firstName: 'Overwriter' })] } },
    );

    expect(second.body?.counts).toEqual({ CREATE: 0, ERROR: 1 });
    const found = await harness.get<{ data: { firstName: string }[] }>(`/employees?q=${code}`,
      { token: hrToken },
    );
    // An import must never quietly rewrite somebody who already exists.
    expect(found.body?.data[0]?.firstName).toBe('Original');
  });
});

describe('who may import', () => {
  it('refuses an employee without employee.manage', async () => {
    const result = await harness.post('/employees/import/commit', {
      token: employeeToken,
      body: { rows: [row(`IMP-${runId}-X`)] },
    });
    expect(result.status).toBe(403);
  });

  it('refuses anonymously', async () => {
    const result = await harness.post('/employees/import/validate', {
      body: { rows: [row(`IMP-${runId}-Y`)] },
    });
    expect(result.status).toBe(401);
  });
});
