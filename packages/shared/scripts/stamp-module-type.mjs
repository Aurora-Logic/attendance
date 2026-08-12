import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node decides whether a .js file is ESM or CommonJS from the nearest
 * package.json "type". Without these two stamps, both build outputs would
 * inherit the package's own type and one of them would be interpreted wrongly:
 * the API would get ESM it cannot require, or Vite would get CommonJS whose
 * named exports it cannot resolve.
 *
 * The second failure is the one that actually happened, and it only showed up
 * as a blank page in the browser — no build error, no type error.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const [dir, type] of [
  ['dist/cjs', 'commonjs'],
  ['dist/esm', 'module'],
]) {
  const target = resolve(root, dir);
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
