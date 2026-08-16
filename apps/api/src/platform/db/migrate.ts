import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies pending migrations. Run on deploy, forward-only (technical design
 * §17).
 *
 * Deliberately its own process rather than something the API does at boot: two
 * instances starting together would race, and a failed migration should stop
 * the deploy rather than leave a half-migrated database serving traffic.
 */
async function main(): Promise<void> {
  const envCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      try { process.loadEnvFile(envPath); } catch {}
    }
  }


  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    const started = Date.now();
    await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    console.log(`migrations applied in ${String(Date.now() - started)}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exit(1);
});
