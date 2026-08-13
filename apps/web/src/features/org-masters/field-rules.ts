/**
 * The two field rules the three org masters share, stated once.
 *
 * They mirror `codeField` and `nameField` in `@vyuha/shared/org`, which is what
 * the server parses with. This is the *message*, not the enforcement: the point
 * is that somebody learns the rule while typing rather than from a 400 that
 * names a Zod issue code.
 *
 * A module of its own rather than exports beside the sheets: a file exporting
 * both a component and a plain function loses React Fast Refresh for the whole
 * file, so an edit to the form would remount the page and throw away whatever
 * was half-typed in it.
 */

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

export const CODE_HELP =
  'Letters, digits, dot, underscore, slash and hyphen. Printed on every report.';

export function codeProblem(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed === '') return 'A code is required.';
  if (trimmed.length > 32) return 'A code is at most 32 characters.';
  if (!CODE_PATTERN.test(trimmed)) return CODE_HELP;
  return null;
}

export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'A name is required.';
  if (trimmed.length > 120) return 'A name is at most 120 characters.';
  return null;
}
