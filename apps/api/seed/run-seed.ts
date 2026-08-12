import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { runSeed, type SeedReport } from './seed.js';

/**
 * `pnpm db:seed`. A thin runner: everything worth testing is in `seed.ts`,
 * which takes a database and returns a report.
 *
 * Its own process for the same reason `db:migrate` is -- no dependency
 * injection, so `tsx` is safe here (see `decorator-metadata.ts` for why it is
 * not safe for the API itself).
 */

const FORCE_FLAG = '--force';

async function main(): Promise<void> {
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  // Seeding resets the four system roles to the PRD §2.1 matrix, which would
  // discard permission edits an administrator made in the UI (REQ-B-07).
  // Harmless on a laptop, not harmless on a live system.
  if (process.env.NODE_ENV === 'production' && !process.argv.includes(FORCE_FLAG)) {
    throw new Error(
      `Refusing to seed with NODE_ENV=production. Re-run with ${FORCE_FLAG} if that is genuinely intended.`,
    );
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    const started = Date.now();
    const report = await runSeed(drizzle(pool), {
      orgName: process.env.SEED_ORG_NAME,
      adminEmail: process.env.SEED_ADMIN_EMAIL,
    });
    print(report, Date.now() - started);
  } finally {
    await pool.end();
  }
}

function print(report: SeedReport, elapsedMs: number): void {
  const lines: string[] = [
    `organisation  ${report.organization.id} ${report.organization.created ? '(created)' : '(already present)'}`,
    `permissions   ${String(report.permissions.inserted)} inserted, ${String(report.permissions.updated)} updated, ${String(report.permissions.removed)} removed`,
  ];

  for (const role of report.roles) {
    lines.push(
      `role          ${role.name.padEnd(11)} ${role.created ? 'created' : 'present'}` +
        `  +${String(role.granted)} permission(s)  -${String(role.revoked)}`,
    );
  }

  lines.push(
    `administrator ${report.admin.email} ${report.admin.created ? '(created)' : '(already present)'}`,
  );

  const master = report.masterData;
  for (const [label, counts] of [
    ['locations', master.locations],
    ['departments', master.departments],
    ['designations', master.designations],
    ['shifts', master.shifts],
    ['employees', master.employees],
  ] as const) {
    lines.push(
      `${label.padEnd(13)} ${String(counts.created)} created, ${String(counts.total)} defined`,
    );
  }
  lines.push(
    `links         ${String(master.links.reportingManagers)} reporting manager(s), ` +
      `${String(master.links.departmentHeads)} department head(s), ` +
      `${String(master.links.defaultShifts)} default shift(s)`,
  );

  process.stdout.write(`${lines.join('\n')}\n`);

  if (report.admin.password !== null) {
    // Printed once, here, and nowhere else. It is not stored, not logged, and
    // not recoverable -- a second run will say the account already exists.
    process.stdout.write(
      [
        '',
        '  ---------------------------------------------------------------',
        '  Administrator password (shown once, not stored anywhere):',
        '',
        `      ${report.admin.password}`,
        '',
        '  Sign in, then change it. Re-running the seed will not print it',
        '  again and will not reset it.',
        '  ---------------------------------------------------------------',
        '',
      ].join('\n'),
    );
  }

  process.stdout.write(`seed completed in ${String(elapsedMs)}ms\n`);
}

main().catch((error: unknown) => {
  console.error('seed failed:', error);
  process.exit(1);
});
