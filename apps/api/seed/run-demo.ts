import { Pool } from 'pg';

import { loadDotEnvFiles } from '../src/platform/common/dotenv.js';
import { seedDemoData } from './demo-data.js';

/**
 * `pnpm db:demo` -- fills one organisation with synthetic data in every module.
 *
 * Three guards, because attendance is in daily use on a real deployment and
 * the cost of pointing this at it is fictional customers and invented invoices
 * inside the books somebody is running the business on.
 *
 *   1. Refuses when NODE_ENV is production.
 *   2. Refuses a DATABASE_URL whose host is not local.
 *   3. Names the database and the organisation before it writes anything, so a
 *      wrong target is visible in the output rather than in the consequences.
 *
 * `--force` defeats 1 and 2 together and is deliberately not documented in the
 * README. Someone who needs it will read this file first, which is the point.
 */

const FORCE = '--force';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'postgres', 'db']);

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    // An unparseable URL is not a local one as far as this check is concerned.
    return '(unparseable)';
  }
}

async function main(): Promise<void> {
  loadDotEnvFiles();
  const force = process.argv.includes(FORCE);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error(
      'Refusing to write demo data with NODE_ENV=production. This creates fictional ' +
        'customers, invoices and purchase orders; they do not belong in a live ledger.',
    );
  }

  const host = hostOf(connectionString);
  if (!LOCAL_HOSTS.has(host) && !force) {
    throw new Error(
      `Refusing to write demo data to a non-local database (host: ${host}). ` +
        'Point DATABASE_URL at your development stack first.',
    );
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const org = (
      await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      )
    ).rows[0];
    if (org === undefined) throw new Error('No organisation found. Run pnpm db:seed first.');

    const database = (await pool.query<{ current_database: string }>('SELECT current_database()'))
      .rows[0]?.current_database;

    // Said before the write, not after: a wrong target should be readable in
    // the terminal while there is still time to press Ctrl-C.
    console.log(`host          ${host}`);
    console.log(`database      ${String(database)}`);
    console.log(`organisation  ${org.name} (${org.id})`);
    console.log('');

    const started = Date.now();
    const report = await seedDemoData(pool, org.id);
    for (const [table, rows] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`${table.padEnd(24)} ${String(rows)}`);
    }
    console.log(`\ndone in ${String(Date.now() - started)}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
