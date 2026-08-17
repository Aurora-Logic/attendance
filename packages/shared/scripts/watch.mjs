import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Ensure module stamps exist
await import('./stamp-module-type.mjs');

const cjs = spawn('tsc -p tsconfig.build.json --watch --preserveWatchOutput', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

const esm = spawn('tsc -p tsconfig.build.esm.json --watch --preserveWatchOutput', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

const cleanup = () => {
  cjs.kill();
  esm.kill();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
