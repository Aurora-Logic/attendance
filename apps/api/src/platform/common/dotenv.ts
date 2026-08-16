import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads `.env` from the working directory and, failing that precedence-wise,
 * from the repository root — so `pnpm --filter @vyuha/api dev` run from the
 * root and a bare `node` run from `apps/api` read the same configuration.
 *
 * Node leaves already-set variables alone, so a value injected by the
 * container, CI, or a one-off shell prefix still wins over either file, and
 * the nearer file wins over the root one.
 *
 * A file that exists but cannot be parsed throws, on purpose. This replaced
 * three copies of the same loop that each swallowed the error, which turned
 * "your .env has a syntax error on line 3" into "the API ignores your
 * settings and you find out from whichever feature misbehaves first".
 */
export function loadDotEnvFiles(): void {
  for (const envPath of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (!existsSync(envPath)) continue;
    process.loadEnvFile(envPath);
  }
}
