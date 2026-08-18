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
  const candidates = [resolve(process.cwd(), '.env')];
  /*
   * The repo-root fallback, only when two levels up actually is this
   * workspace's root. From the repo root itself, '../../.env' escapes the
   * repository entirely — on this machine it would be the operator's home
   * directory — and silently absorbing an unrelated file's variables (or
   * crashing on its syntax) is worse than not looking.
   */
  const workspaceRoot = resolve(process.cwd(), '../..');
  if (existsSync(resolve(workspaceRoot, 'pnpm-workspace.yaml'))) {
    candidates.push(resolve(workspaceRoot, '.env'));
  }
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    process.loadEnvFile(envPath);
  }
}
