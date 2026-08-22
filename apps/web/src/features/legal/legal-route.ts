/**
 * Which legal document a path asks for, if any. Matched in SessionGate like
 * the token screens, because these pages have to be readable by somebody
 * who has not signed in: signing in is how they are accepted.
 */
export function legalRoute(pathname: string): string | null {
  const prefix = '/legal/';
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).replace(/\/+$/u, '');
}
