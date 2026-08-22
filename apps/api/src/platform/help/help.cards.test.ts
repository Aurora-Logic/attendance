import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ERROR_CODES, HELP_TOPICS, PERMISSIONS } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { HELP_CARDS } from './help.cards.js';

/**
 * What stops the corpus rotting.
 *
 * This repository has already produced the failure twice. A-01 deleted
 * `regularization.raise` and `regularization.approve` from the permission
 * catalogue outright, taking a screen and a tour step with them. And
 * `changelog.test.ts` passes 13/13 over a changelog whose newest entry is
 * v0.9.0 while the branch it runs on is 97 commits ahead — green because its
 * guard checks that entries resolve, and deletion is not the failure mode.
 * Divergence is.
 *
 * So the assertions that earn their keep are the two that reach outside this
 * file: every `tourStep` must exist in the web app's guide registry, and every
 * `route` must be a real destination. Neither is type-checked — they are
 * strings — and both are exactly what a rename breaks silently, leaving a
 * **Show me** button that highlights nothing and an answer that boosts on a
 * screen nobody can reach.
 *
 * Reading the web app's sources from an API test is the same move
 * `settings.catalogue.test.ts` makes across the platform/module boundary:
 * where an import is not allowed, the strings are repeated and a test asserts
 * they still agree.
 */

// `__dirname` rather than `import.meta.url`, for the reason
// settings.catalogue.test.ts gives: this package compiles to CommonJS and
// `import.meta` is a type error under that module setting.
const WEB_SRC = resolve(__dirname, '../../../../web/src');

function readWeb(relativePath: string): string {
  const full = resolve(WEB_SRC, relativePath);
  try {
    return readFileSync(full, 'utf8');
  } catch {
    throw new Error(
      `help.cards.test.ts cannot read ${relativePath}. If the file moved, this corpus is now ` +
        'referencing something that may no longer exist — update the path here and re-check every card.',
    );
  }
}

/** Step ids as the registry declares them. */
function tourStepIds(): Set<string> {
  const source = readWeb('features/guide/tour-steps.ts');
  const ids = [...source.matchAll(/\bid:\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined);
  expect(ids.length, 'no tour step ids parsed — the registry format changed').toBeGreaterThan(20);
  return new Set(ids);
}

/** Every path the navigation can reach. */
function navPaths(): Set<string> {
  const source = readWeb('lib/nav.ts');
  const paths = [...source.matchAll(/'(\/[a-z0-9/_-]*)'/g)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined);
  expect(paths.length, 'no routes parsed — nav.ts format changed').toBeGreaterThan(20);
  return new Set(paths);
}

describe('help card corpus', () => {
  it('gives every card a unique id', () => {
    const ids = HELP_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every tour step at a step that exists', () => {
    const steps = tourStepIds();
    const dangling = HELP_CARDS.filter(
      (card) => card.tourStep !== null && !steps.has(card.tourStep),
    ).map((card) => `${card.id} -> ${card.tourStep ?? ''}`);
    expect(dangling).toEqual([]);
  });

  it('points every route at a destination that exists', () => {
    const paths = navPaths();
    const dangling = HELP_CARDS.filter(
      (card) => card.route !== null && !paths.has(card.route),
    ).map((card) => `${card.id} -> ${card.route ?? ''}`);
    expect(dangling).toEqual([]);
  });

  it('names only live permission keys', () => {
    const keys = new Set<string>(Object.values(PERMISSIONS));
    const unknown = HELP_CARDS.filter(
      (card) => card.permission !== null && !keys.has(card.permission),
    ).map((card) => `${card.id} -> ${card.permission ?? ''}`);
    expect(unknown).toEqual([]);
  });

  it('names only live error codes', () => {
    const codes = new Set<string>(Object.values(ERROR_CODES));
    const unknown = HELP_CARDS.flatMap((card) =>
      card.errorCodes.filter((code) => !codes.has(code)).map((code) => `${card.id} -> ${code}`),
    );
    expect(unknown).toEqual([]);
  });

  it('files every card under a known topic', () => {
    const topics = new Set<string>(HELP_TOPICS);
    const unknown = HELP_CARDS.filter((card) => !topics.has(card.topic)).map((card) => card.id);
    expect(unknown).toEqual([]);
  });

  /*
   * The answer is rendered verbatim, so length is the contract. Past three
   * sentences it stops being an answer and starts being the article this
   * feature exists not to show — and the panel has no "read more".
   */
  it('keeps every answer short enough to be read in place', () => {
    const tooLong = HELP_CARDS.filter((card) => card.answer.length > 400).map(
      (card) => `${card.id} (${card.answer.length})`,
    );
    expect(tooLong).toEqual([]);
  });

  it('phrases every question as a question a person would ask', () => {
    const empty = HELP_CARDS.filter((card) => card.question.trim().length < 10).map(
      (card) => card.id,
    );
    expect(empty).toEqual([]);
  });

  /*
   * Aliases are the entire substitute for a model's tolerance of paraphrase.
   * A card with none is reachable only by someone who guessed the canonical
   * wording, which is the one person who did not need help.
   */
  it('gives every card aliases, lowercased so matching never has to case-fold', () => {
    const bad = HELP_CARDS.filter(
      (card) =>
        card.aliases.length < 3 ||
        card.aliases.some((alias) => alias !== alias.toLowerCase() || alias.trim() === ''),
    ).map((card) => card.id);
    expect(bad).toEqual([]);
  });

  // CLAUDE.md §3 rule 2. This text renders in the UI, so the rule reaches it.
  it('carries no emoji', () => {
    const withEmoji = HELP_CARDS.filter((card) =>
      /\p{Extended_Pictographic}/u.test(`${card.question} ${card.answer} ${card.aliases.join(' ')}`),
    ).map((card) => card.id);
    expect(withEmoji).toEqual([]);
  });

  /*
   * CLAUDE.md §3.7 and §7: no payroll calculation, and stop rather than guess
   * on money or statutory rules. A help answer is the easiest place in the
   * product to start giving that advice by accident, and the hardest place to
   * notice it.
   *
   * "Payroll" itself is not on the list. The product's whole stated purpose is
   * to produce payroll inputs and hand them off, so naming the system that
   * consumes attendance is on-message — two cards do it correctly, explaining
   * why a locked period cannot move and why an employee code is fixed. What is
   * forbidden is an amount or a statutory rule.
   */
  it('never answers a payroll or statutory question', () => {
    const forbidden = /\b(salary|wage|deduction|income tax|gratuity|provident fund|pf|esi)\b/i;
    const offenders = HELP_CARDS.filter((card) => forbidden.test(card.answer)).map(
      (card) => card.id,
    );
    expect(offenders).toEqual([]);
  });
});
