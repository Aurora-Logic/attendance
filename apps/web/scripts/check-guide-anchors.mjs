#!/usr/bin/env node
/**
 * Fails when the guided tour names an anchor that no longer exists in the UI.
 *
 * The tour finds its targets through `data-guide="…"` attributes on ordinary
 * controls. That is a deliberately weak coupling — an attribute, not a
 * structure — but it is still a coupling, and its failure mode is silent: a
 * refactor drops an attribute, the step is skipped at runtime, and nothing
 * goes red. This is what turns that slow rot into a failed build.
 *
 * Deliberately dependency-free. `apps/web` has no test runner, and adding
 * vitest, jsdom and testing-library to get one is a dependency decision that
 * belongs to a human (CLAUDE.md §6). This reads the source instead: it cannot
 * catch an anchor that renders twice at runtime, and that limitation is stated
 * in the output rather than hidden.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(WEB_ROOT, 'src');
const REGISTRY = join(SRC, 'features/guide/tour-steps.ts');

/** Every .ts/.tsx file under src, minus the registry itself. */
async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await sourceFiles(full)));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const registrySource = await readFile(REGISTRY, 'utf8');

/*
 * The anchor names the registry can produce.
 *
 * Read from the ANCHORS map rather than from each step, because a step names
 * its anchor through that map — so the map is the complete set, and a value in
 * it that no step uses is just as much a mistake as a step with no attribute.
 */
const anchorsBlock = /export const ANCHORS = \{([\s\S]*?)\} as const;/.exec(registrySource);
if (!anchorsBlock) {
  console.error('check-guide-anchors: could not find the ANCHORS map in tour-steps.ts.');
  process.exit(1);
}

const declared = [...anchorsBlock[1].matchAll(/^\s*\w+:\s*'([^']+)'/gm)].map((m) => m[1]);
if (declared.length === 0) {
  console.error('check-guide-anchors: the ANCHORS map is empty.');
  process.exit(1);
}

const files = await sourceFiles(SRC);
const occurrences = new Map(declared.map((name) => [name, []]));

for (const file of files) {
  if (file === REGISTRY) continue;
  const text = await readFile(file, 'utf8');
  for (const name of declared) {
    // Matches the literal attribute as written in JSX: data-guide="nav.groups"
    const pattern = new RegExp(`data-guide=(["'])${name.replace(/\./gu, '\\.')}\\1`, 'gu');
    const hits = text.match(pattern);
    if (hits) occurrences.get(name).push({ file: relative(WEB_ROOT, file), count: hits.length });
  }
}

const missing = declared.filter((name) => occurrences.get(name).length === 0);

if (missing.length > 0) {
  console.error('check-guide-anchors: FAILED\n');
  for (const name of missing) {
    console.error(
      `  data-guide="${name}" is named by the tour but appears on no element.\n` +
        '    The step that uses it will be silently skipped at runtime.\n' +
        '    Either restore the attribute, or remove the anchor and its steps.\n',
    );
  }
  process.exit(1);
}

console.log(`check-guide-anchors: ${String(declared.length)} anchors, all present.`);
for (const name of declared) {
  const places = occurrences.get(name);
  const total = places.reduce((sum, p) => sum + p.count, 0);
  console.log(
    `  ${name.padEnd(20)} ${String(total)} in ${places.map((p) => p.file).join(', ')}`,
  );
}
console.log(
  '\nNote: this reads source, so a count above 1 is only a warning sign — a screen\n' +
    'may render the same shared component in several mutually exclusive branches.\n' +
    'It cannot prove exactly one renders at a time; that needs a DOM test runner.',
);
