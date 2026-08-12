import { defineConfig } from 'drizzle-kit';

/**
 * Both globs are listed so a module's tables are diffed alongside the
 * platform's, while the runtime client stays schema-agnostic — see ADR 0001
 * for why the boundary rule costs us the relational query API.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/platform/**/*.schema.ts', './src/modules/**/*.schema.ts'],
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://vyuha:vyuha_dev_only@localhost:5432/vyuha',
  },
  verbose: true,
  strict: true,
});
